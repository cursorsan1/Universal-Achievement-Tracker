import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import fs from 'fs';

// Setup basic mocks before importing server
vi.mock('axios');

describe('getScrapedSteamImage error handling', () => {
  let getScrapedSteamImage: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import dynamically so we can control the environment
    const server = await import('./server');
    getScrapedSteamImage = server.getScrapedSteamImage;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles axios errors gracefully', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Mock an axios rejection
    (axios.get as any).mockRejectedValue(new Error('Network Error'));

    // Execute the function
    const result = await getScrapedSteamImage('12345', 'STEAM');

    // Expectations
    expect(axios.get).toHaveBeenCalledWith(
      'https://store.steampowered.com/app/12345',
      expect.any(Object)
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Scraping failed for AppID 12345:',
      'Network Error'
    );
    expect(result).toBeNull();
  });
});
