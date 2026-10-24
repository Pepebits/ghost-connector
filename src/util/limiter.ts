import pLimit from 'p-limit';

// Max concurrency per service, shared across all posts being
// processed in parallel (not per post): keeps N parallel posts from
// multiplying the load on each external API.
export const ghostLimiter = pLimit(2);
export const aiLimiter = pLimit(4); // calls to the AI provider
export const unsplashLimiter = pLimit(1);
export const pexelsLimiter = pLimit(2); // Pexels limit (200/h) is looser than Unsplash
export const pixabayLimiter = pLimit(2); // 100 requests/minute
export const wikimediaLimiter = pLimit(1); // keyless: be polite with Wikimedia
export const openverseLimiter = pLimit(1); // no key: 20/min and 200/day
