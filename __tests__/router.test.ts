import Crypto from 'crypto';

import { jest } from '@jest/globals';

import { createApp, HttpStatusCode } from '../src';
import { unseal } from '../src/utils/encryptCookies';

import type { HandlerArguments } from '../src/modules/shared';
import type { Json } from '@typeofweb/utils';

declare module '../src' {
  interface TypeOfWebEvents {
    readonly HELLO_EVENTS_TEST: number;
  }
}

describe('router', () => {
  describe('cookies', () => {
    it('should set cookies', async () => {
      const app = createApp({ cookies: { secret: 'a'.repeat(32) } }).route({
        path: '/users',
        method: 'get',
        validation: {},
        handler: async (_request, t) => {
          await t.setCookie('test', 'testowa', { encrypted: false });
          return null;
        },
      });

      const result = await app.inject({
        method: 'get',
        path: '/users',
      });

      expect(result.headers['set-cookie']).toEqual([`test=testowa; Path=/; HttpOnly; Secure; SameSite=Lax`]);
    });

    it('should set encrypted cookies', async () => {
      const secret = Crypto.randomBytes(22).toString('base64');
      const app = createApp({ cookies: { secret } }).route({
        path: '/users',
        method: 'get',
        validation: {},
        handler: async (_request, t) => {
          await t.setCookie('test', 'testowa', { encrypted: true });
          return null;
        },
      });

      const result = await app.inject({
        method: 'get',
        path: '/users',
      });

      expect(result.headers['set-cookie']).toHaveLength(1);
      const [key, val] = (result.headers['set-cookie'] as readonly [string])[0].split(';')[0]!.split('=');
      expect(key).toEqual('test');
      expect(await unseal({ sealed: val!, secret })).toEqual('testowa');
    });

    it('should read all cookies', async () => {
      const handler = jest.fn<Json, HandlerArguments>().mockReturnValue(null);

      const app = createApp({ cookies: { secret: 'a'.repeat(32) } }).route({
        path: '/users',
        method: 'get',
        validation: {},
        handler,
      });

      await app.inject({
        method: 'get',
        path: '/users',
        cookies: [
          'test=testowa',
          'secret=Fe26.2**n0Jf_bWyQEP8IGbXE2USt82PE9W_dGIvOSlLTeKvwnA*a_fJJWNvbhjvvy0yBg2APw*PzP5xlZ63c6EImBsgDaZ7A**LF1tHWLrtR1pckVC9moT-V2b8LVmE_NYWfsgYqYhZwk*i40hiIKMSNNpwQUmd2HalR9KEvODTfDRPLah2H_q2JqdPg3ecHW6PvnJTC2YAHGUiwvIERWqE5LvaSjCyULvbQ',
        ],
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ cookies: { test: 'testowa', secret: 'testowa' } }),
        expect.any(Object),
      );
    });

    it('should not accept multiple params in path segment', () => {
      const app = createApp({});

      return expect(() =>
        app.route({
          path: '/currencies/:from-:to',
          method: 'get',
          validation: {
            params: {} as any,
          },

          handler: () => {
            return { message: 'OKEJ' };
          },
        }),
      ).toThrowErrorMatchingInlineSnapshot(`"RouteValidationError: Each path segment can contain at most one param."`);
    });

    it('should not accept regexes', () => {
      const app = createApp({});

      return expect(() =>
        app.route({
          path: '/currencies/:from(\\d+)',
          method: 'get',
          validation: {
            params: {} as any,
          },

          handler: () => {
            return { message: 'OKEJ' };
          },
        }),
      ).toThrowErrorMatchingInlineSnapshot(
        `"RouteValidationError: Don't use regular expressions in routes. Use validators instead."`,
      );
    });

    it('should remove cookies', async () => {
      const app = createApp({ cookies: { secret: 'a'.repeat(32) } }).route({
        path: '/users',
        method: 'get',
        validation: {},
        handler: async (_request, t) => {
          await t.removeCookie('test', { encrypted: false });
          return null;
        },
      });

      const result = await app.inject({
        method: 'get',
        path: '/users',
      });

      expect(result.headers['set-cookie']).toEqual([
        'test=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
      ]);
    });
  });

  describe('headers', () => {
    it('should set headers', async () => {
      const app = createApp({}).route({
        path: '/test',
        method: 'get',
        validation: {},
        handler: async (_request, t) => {
          await t.setHeader('test', 'testowa');
          return null;
        },
      });

      const result = await app.inject({
        method: 'get',
        path: '/test',
      });

      expect(result.headers['test']).toEqual('testowa');
    });

    it('should ignore result when response was sent manually', async () => {
      const app = createApp({}).route({
        path: '/test',
        method: 'get',
        validation: {},
        handler: (request) => {
          request._rawRes.status(203).end();
          return { a: 123 };
        },
      });

      const result = await app.inject({
        method: 'get',
        path: '/test',
      });

      expect(result.body).toEqual({});
      expect(result.statusCode).toEqual(203);
    });

    it('should ignore result when error was sent manually', async () => {
      const app = createApp({}).route({
        path: '/test',
        method: 'get',
        validation: {},
        handler: (request) => {
          request._rawRes.status(501).end();
          throw new Error();
        },
      });

      const result = await app.inject({
        method: 'get',
        path: '/test',
      });

      expect(result.body).toEqual({});
      expect(result.statusCode).toEqual(501);
    });
  });

  describe('status code', () => {
    it('should allow overriding status codes', async () => {
      const app = createApp({}).route({
        path: '/users',
        method: 'get',
        validation: {},
        handler: async (req, t) => {
          await t.setStatus(HttpStatusCode.Accepted);
          return null;
        },
      });

      const result = await app.inject({
        method: 'get',
        path: '/users',
      });
      expect(result.statusCode).toEqual(202);
    });
  });

  describe('specificity', () => {
    const routePaths = [
      '/',
      '/a',
      '/b',
      '/ab',
      '/:p',
      '/a/b',
      '/a/:p',
      '/b/',
      '/a/b/c',
      '/a/b/:p',
      '/a/:p/b',
      '/a/:p/c',
      '/a/b/c/d',
      '/a/:p/b/:x',
      '/a/b/*',
      '/:a/b/*',
      '/*',
      '/m/n/*',
      '/m/:n/:o',
      '/n/:p/*',
    ].sort(() => Math.random() - 0.5);

    const requests = [
      ['/', '/'],
      ['/a', '/a'],
      ['/b', '/b'],
      ['/ab', '/ab'],
      ['/c', '/:p'],
      ['/a/b', '/a/b'],
      ['/a/c', '/a/:p'],
      ['/b/', '/b/'],
      ['/a/b/c', '/a/b/c'],
      ['/a/b/d', '/a/b/:p'],
      ['/a/a/b', '/a/:p/b'],
      ['/a/d/c', '/a/:p/c'],
      ['/a/b/c/d', '/a/b/c/d'],
      ['/a/c/b/d', '/a/:p/b/:x'],
      ['/a/b/c/d/e', '/a/b/*'],
      ['/a/b/c/d/e/f', '/a/b/*'],
      ['/x/b/c/d/e/f/g', '/:a/b/*'],
      ['/x/y/c/d/e/f/g', '/*'],
      ['/m/n/o', '/m/n/*'],
      ['/m/o/p', '/m/:n/:o'],
      ['/n/a/b/c', '/n/:p/*'],
      ['/n/a/', '/n/:p/*'],
    ];

    const strictApp = createApp({ router: { strictTrailingSlash: true } });
    routePaths.forEach((routePath) =>
      strictApp.route({
        path: routePath,
        method: 'get',
        validation: {},
        handler: (req) => req.path,
      }),
    );

    const looseApp = createApp({ router: { strictTrailingSlash: false } });
    routePaths.forEach((routePath) =>
      looseApp.route({
        path: routePath,
        method: 'get',
        validation: {},
        handler: (req) => req.path,
      }),
    );

    it.each(requests)('strict: %p → %p', async (requestPath, requestRoute) => {
      const result = await strictApp.inject({
        method: 'get',
        path: requestPath,
      });
      expect(result.body).toEqual(requestRoute);
    });

    it.each(requests)('loose: %p → %p', async (requestPath, requestRoute) => {
      const result = await looseApp.inject({
        method: 'get',
        path: requestPath,
      });
      // trim trailing slash
      expect(result.body).toEqual(requestRoute.replace(/(.+)\/$/, '$1'));
    });
  });
});
