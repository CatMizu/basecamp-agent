export const API_BASE_URL_PREFIX = 'https://3.basecampapi.com';
export const LAUNCHPAD_URL = 'https://launchpad.37signals.com';

/** Max characters in a single tool response before truncation kicks in. */
export const CHARACTER_LIMIT = 25_000;

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** Refresh Basecamp tokens this many seconds before they expire. */
export const REFRESH_BUFFER_SEC = 60;

/** Tokens Launchpad issues with no expires_in default to this (Basecamp: 2 weeks). */
export const DEFAULT_BASECAMP_EXPIRES_IN = 14 * 24 * 60 * 60;

export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json',
}
