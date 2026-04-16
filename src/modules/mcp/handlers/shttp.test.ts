import { jest, describe, test, expect } from '@jest/globals';
import type { Request, Response } from 'express';
import { handleStreamableHTTP } from './shttp.js';

function makeReq(auth?: Request['auth']): Request {
  return {
    auth,
    method: 'POST',
    body: {},
  } as unknown as Request;
}

function makeRes(): {
  res: Response;
  status: jest.Mock;
  json: jest.Mock;
  onClose: () => void;
} {
  let closeHandler: () => void = () => {};
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = {
    headersSent: false,
    status,
    json,
    on: (event: string, fn: () => void) => {
      if (event === 'close') closeHandler = fn;
      return res;
    },
  } as unknown as Response;
  return { res, status: status as unknown as jest.Mock, json: json as unknown as jest.Mock, onClose: () => closeHandler() };
}

describe('handleStreamableHTTP', () => {
  test('returns 401 when no auth.extra.userId', async () => {
    const { res, status } = makeRes();
    await handleStreamableHTTP(makeReq(), res);
    expect(status).toHaveBeenCalledWith(401);
  });

  test('returns 401 when auth has no userId', async () => {
    const { res, status } = makeRes();
    await handleStreamableHTTP(
      makeReq({
        token: 't',
        clientId: 'c',
        scopes: ['mcp'],
        extra: {},
      } as Request['auth']),
      res,
    );
    expect(status).toHaveBeenCalledWith(401);
  });
});
