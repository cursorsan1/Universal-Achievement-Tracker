# Universal Achievement Manager - Python Architektúra

Ez a dokumentum a backend Python architektúrájának tervét tartalmazza.

## Fájlstruktúra

A modulos felépítés (Separation of Concerns) kritikus, mivel több, teljesen eltérő technológiát használó forrást is be kell integrálnunk.

```text
universal_achievement_manager/
â”œâ”€â”€ core/
â”‚   â”œâ”€â”€ __init__.py
â”‚   â”œâ”€â”€ models.py          # Adatmodellek (Achievement, Game osztályok)
â”‚   â””â”€â”€ mapping.py         # Folyamat -> AppID logika (psutil/watchdog)
â”œâ”€â”€ providers/             # Adapter pattern a kÃ¼lÃ¶nbÃ¶zÅ‘ platformokhoz
â”‚   â”œâ”€â”€ __init__.py
â”‚   â”œâ”€â”€ base.py            # 'BaseProvider' abstract class
â”‚   â”œâ”€â”€ steam_web.py       # Hivatalos Steam Web API
â”‚   â”œâ”€â”€ steam_goldberg.py  # Goldberg Emulator JSON parser
â”‚   â”œâ”€â”€ xbox_live.py       # Xbox Live Web API (X-Token hitelesÃ­tÃ©ssel)
â”‚   â”œâ”€â”€ rpcs3_parser.py    # TROPUSR.DAT binÃ¡ris & TROPCONF.SFM XML olvasÃ³
â”‚   â””â”€â”€ retroachievements.py # RetroAchievements API
â”œâ”€â”€ gui/                   # PyQt / CustomTkinter frontend felÃ¼let
â”‚   â”œâ”€â”€ __init__.py
â”‚   â”œâ”€â”€ main_window.py
â”‚   â””â”€â”€ views/             # KategÃ³ria nÃ©zetek kÃ¼lÃ¶n
â”œâ”€â”€ data/                  
â”‚   â””â”€â”€ app_mapping.json   # EXE nevÃ©t Ã©s metaadatokat tÃ¡rolÃ³ szÃ³tÃ¡r
â””â”€â”€ main.py                # FÅ‘ belÃ©pÃ©si pont
```

## 1. Unified Data Model (`core/models.py`)

A cÃ©l, hogy a kÃ¼lÃ¶nbÃ¶zÅ‘ API-k (Web, binÃ¡ris, JSON) azonos adatstruktÃºrÃ¡t adjanak vissza a GUI szÃ¡mÃ¡ra.

```python
from dataclasses import dataclass, field
from typing import List, Optional
from datetime import datetime

@dataclass
class Achievement:
    api_id: str             # Eredeti azonosÃ­tÃ³ az adott platformon (pl. "NEW_ACHIEVEMENT_1_0" vagy "001")
    title: str
    description: str
    platform: str           # "Steam", "Xbox", "RPCS3", "RetroAchievements", "Goldberg"
    is_unlocked: bool
    icon_url_or_path: str   # URL web API-nÃ¡l, helyi fÃ¡jl Ãºtvonal RPCS3/Goldberg esetÃ©n
    unlock_time: Optional[datetime] = None
    rarity_percentage: Optional[float] = None
    gamescore: Optional[int] = None # FÅ‘leg Xbox Ã©s RetroAchievements esetÃ©n

@dataclass
class Game:
    game_id: str            # Steam AppID, Xbox TitleID, vagy PS3 TitleID (pl. BLES01807)
    title: str
    platform: str
    achievements: List[Achievement] = field(default_factory=list)
    executable_name: Optional[str] = None
    total_playtime_minutes: int = 0
    cover_art: Optional[str] = None

    @property
    def completion_rate(self) -> float:
        if not self.achievements:
            return 0.0
        unlocked = sum(1 for a in self.achievements if a.is_unlocked)
        return (unlocked / len(self.achievements)) * 100
```

## 2. Process & FÃ¡jl Mapping Rendszer (`core/mapping.py`)

Mivel lokÃ¡lis emulÃ¡torokat (Goldberg, RPCS3) vizsgÃ¡lunk, meg kell tudni Ã¡llapÃ­tani, melyik jÃ¡tÃ©k fut Ã©ppen. A `psutil` segit megtalÃ¡lni a folyamatot, a `watchdog` pedig Ã©rtesÃ­t a mentÃ©sfÃ¡jlok mÃ³dosulÃ¡sakor.

```python
import psutil
import json
from typing import Optional

class AppIDMapper:
    def __init__(self, mapping_file: str = "data/app_mapping.json"):
        with open(mapping_file, "r", encoding="utf-8") as f:
            self.mapping = json.load(f)
            # StruktÃºra: 
            # { "reddeadredemption2.exe": {"platform": "Steam", "game_id": "1174180"} }

    def get_game_by_process_name(self, process_name: str) -> Optional[dict]:
        return self.mapping.get(process_name.lower())

    def scan_running_games(self):
        running_games = []
        for proc in psutil.process_iter(['name', 'exe']):
            try:
                proc_name = proc.info.get('name', '').lower()
                matched_game = self.get_game_by_process_name(proc_name)
                if matched_game:
                    running_games.append(matched_game)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return running_games
```

### Specifikus megvalÃ³sÃ­tÃ¡sok:
- **Goldberg Emu**: A `watchdog.observers.Observer` figyeli az `%APPDATA%\Goldberg SteamEmu Saves\{AppID}\achievements.json` vÃ¡ltozÃ¡sait lokÃ¡lis "Live" visszajelzÃ©shez.
- **RPCS3**: Az RPCS3 TROPCONF.SFM olvashatÃ³ XML, ami adja a nevet Ã©s a feltÃ©teleket, mÃ­g a `TROPUSR.DAT` binÃ¡ris. TROPUSR parsernÃ©l: 0x40 offsetnÃ©l kezdÅ‘dik Ã¡ltalÃ¡ban az achievementek bitmaszkja/arraye. 

## 3. Abstract Provider Pattern

Így garantálható, hogy minden adatforrás azonos kimenetet ad.

```python
from abc import ABC, abstractmethod
from typing import List
from .models import Game, Achievement

class BaseProvider(ABC):
    @property
    @abstractmethod
    def platform_name(self) -> str:
        pass

    @abstractmethod
    def fetch_games(self) -> List[Game]:
        """LekÃ©ri a felhasznÃ¡lÃ³ Ã¶sszes jÃ¡tÃ©kÃ¡t a platformon."""
        pass

    @abstractmethod
    def fetch_achievements(self, game_id: str) -> List[Achievement]:
        """Adott jÃ¡tÃ©k achievementjeit szedi Ã¶ssze."""
        pass
```
