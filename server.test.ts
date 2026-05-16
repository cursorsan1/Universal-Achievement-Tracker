import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import * as fs from 'fs';
import { getScrapedSteamImage } from './server';

// Mock fs and axios
vi.mock('fs');
vi.mock('axios');

describe('getScrapedSteamImage', () => {
  const mockAppId = '12345';
  const mockUrl = `https://store.steampowered.com/app/${mockAppId}`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null if platform is not STEAM or GOLDBERG', async () => {
    // Return empty cache
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');

    const result = await getScrapedSteamImage(mockAppId, 'XBOX');
    expect(result).toBeNull();
  });

  it('should return cached URL if it exists', async () => {
    const mockCachedUrl = 'https://cached.url/image.jpg';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ [mockAppId]: mockCachedUrl }));

    const result = await getScrapedSteamImage(mockAppId, 'STEAM');
    expect(result).toBe(mockCachedUrl);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('should scrape and return header image URL if not in cache', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');

    const mockHtml = `<html><body><img class="game_header_image_full" src="https://scraped.url/header.jpg?t=123" /></body></html>`;
    vi.mocked(axios.get).mockResolvedValue({ data: mockHtml });
    vi.mocked(axios.head).mockResolvedValue({ status: 200 } as any);

    const result = await getScrapedSteamImage(mockAppId, 'STEAM');

    expect(axios.get).toHaveBeenCalledWith(mockUrl, expect.any(Object));
    expect(result).toBe('https://scraped.url/header.jpg');
    expect(fs.writeFileSync).toHaveBeenCalled(); // Should save to cache
  });

  it('should scrape and return og:image URL if header image is missing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');

    const mockHtml = `<html><head><meta property="og:image" content="https://scraped.url/og.jpg?t=123" /></head><body></body></html>`;
    vi.mocked(axios.get).mockResolvedValue({ data: mockHtml });
    vi.mocked(axios.head).mockResolvedValue({ status: 200 } as any);

    const result = await getScrapedSteamImage(mockAppId, 'STEAM');

    expect(axios.get).toHaveBeenCalledWith(mockUrl, expect.any(Object));
    expect(result).toBe('https://scraped.url/og.jpg');
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('should return null if no image found on page', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');

    const mockHtml = `<html><body><div>No images here</div></body></html>`;
    vi.mocked(axios.get).mockResolvedValue({ data: mockHtml });

    const result = await getScrapedSteamImage(mockAppId, 'STEAM');

    expect(result).toBeNull();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('should handle axios errors gracefully and return null', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');

    vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

    const result = await getScrapedSteamImage(mockAppId, 'STEAM');

    expect(result).toBeNull();
  });

  it('should return null if the head check fails for the scraped url', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');

    const mockHtml = `<html><body><img class="game_header_image_full" src="https://scraped.url/header.jpg?t=123" /></body></html>`;
    vi.mocked(axios.get).mockResolvedValue({ data: mockHtml });
    vi.mocked(axios.head).mockRejectedValue(new Error('Head check failed'));

    const result = await getScrapedSteamImage(mockAppId, 'STEAM');

    expect(result).toBeNull();
    expect(fs.writeFileSync).not.toHaveBeenCalled(); // Should not save to cache if url is invalid
  });
});
