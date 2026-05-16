const fs = require('fs');
const path = require('path');

// Basic mock data
const result = [];
for (let i = 0; i < 50; i++) {
  result.push({
    id: i.toString(),
    unlocked_achievements: 10
  });
}

const notifiedMap = {};

// We simulate fetch
global.fetch = async (url) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        json: async () => ({
          Achievements: {
            "1": { ID: 1, Title: "A", Description: "B", DateEarned: "2023-01-01" }
          }
        })
      });
    }, 50); // 50ms latency
  });
};

const detectNewAchievements = async () => {
    return [{ id: 1 }];
};

async function originalCode() {
  const notifications = [];
  const raUser = 'test';
  const raKey = 'test';

  const start = performance.now();

  for (const game of result) {
    const gameKey = `retroachievements-${game.id}`;
    const notifiedList = notifiedMap[gameKey] || [];

    if (game.unlocked_achievements > notifiedList.length) {
      try {
        // Fetch full list for detection
        const detailRes = await fetch(`https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php?u=${raUser}&g=${game.id}&z=${raUser}&y=${raKey}`);
        const detail = await detailRes.json();
        const internalAchs = Object.values(detail.Achievements || {}).map((ach) => ({
          api_id: String(ach.ID),
          title: ach.Title,
          description: ach.Description,
          is_unlocked: !!ach.DateEarned
        }));
        const newNotifs = await detectNewAchievements(game, internalAchs, "RetroAchievements");
        notifications.push(...newNotifs);
      } catch (e) {}
    }
  }

  const end = performance.now();
  console.log(`Original Code: ${end - start} ms`);
}

async function optimizedCode() {
  const notifications = [];
  const raUser = 'test';
  const raKey = 'test';

  const start = performance.now();

  const gamesToFetch = result.filter(game => {
    const gameKey = `retroachievements-${game.id}`;
    const notifiedList = notifiedMap[gameKey] || [];
    return game.unlocked_achievements > notifiedList.length;
  });

  const chunkSize = 10;
  for (let i = 0; i < gamesToFetch.length; i += chunkSize) {
    const chunk = gamesToFetch.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (game) => {
      try {
        const detailRes = await fetch(`https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php?u=${raUser}&g=${game.id}&z=${raUser}&y=${raKey}`);
        const detail = await detailRes.json();
        const internalAchs = Object.values(detail.Achievements || {}).map((ach) => ({
          api_id: String(ach.ID),
          title: ach.Title,
          description: ach.Description,
          is_unlocked: !!ach.DateEarned
        }));
        const newNotifs = await detectNewAchievements(game, internalAchs, "RetroAchievements");
        notifications.push(...newNotifs);
      } catch (e) {}
    }));
  }

  const end = performance.now();
  console.log(`Optimized Code: ${end - start} ms`);
}

async function run() {
    await originalCode();
    await optimizedCode();
}

run();
