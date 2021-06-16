import { URL } from 'url';

import Cors from 'cors';
import Supertest from 'supertest';

import { deepMerge } from '../utils/merge';
import { generateServerId } from '../utils/uniqueId';

import { createEventBus } from './events';
import { initApp, listenExpressServer } from './http';
import { initRouter, validateRoute } from './router';

import type { DeepPartial, DeepWritable } from '../utils/types';
import type { TypeOfWebServerMeta } from './augment';
import type { TypeOfWebPluginInternal } from './plugins';
import type { AppOptions, TypeOfWebApp, TypeOfWebServer } from './shared';

const defaultAppOptions: AppOptions = {
  hostname: 'localhost',
  port: 3000,
  cors: {
    origin: true,
    credentials: true,
  },
};

export function createApp(opts: DeepPartial<AppOptions>): TypeOfWebApp {
  const options = deepMerge(opts, defaultAppOptions);

  const server: DeepWritable<TypeOfWebServer> = {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- these properties are supposed to be added by the plugins inside `async start()`
    plugins: {} as TypeOfWebServer['plugins'],
    events: createEventBus(),
    get address() {
      return null;
    },

    id: generateServerId(),
  };

  /* eslint-disable functional/prefer-readonly-type -- ok */
  const routes: Array<Parameters<TypeOfWebApp['route']>[0]> = [];
  /* eslint-disable functional/prefer-readonly-type -- ok */
  const plugins: Array<TypeOfWebPluginInternal<string>> = [];

  let mutableIsInitialized = false;

  function initServerPlugins() {
    return Promise.all(
      plugins.map(async (plugin) => {
        if (!plugin?.value || typeof plugin?.value.server !== 'function') {
          return;
        }

        // @ts-expect-error
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- serverMetadata will have valid type
        const serverMetadata = (await plugin.value.server(
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- make server readonly
          server as TypeOfWebServer,
        )) as unknown as TypeOfWebServerMeta[keyof TypeOfWebServerMeta];

        if (serverMetadata) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- if serverMetadata exists then plugin name is keyof TypeOfWebServerMeta
          server.plugins[plugin.name as keyof TypeOfWebServerMeta] = serverMetadata;
        }
      }),
    );
  }

  async function initialize() {
    if (mutableIsInitialized) {
      return;
    }

    if (options.cors) {
      app._rawExpressApp.use(
        Cors({
          origin: options.cors.origin,
          credentials: options.cors.credentials,
        }),
      );
    }

    await initServerPlugins();

    app._rawExpressRouter = initRouter({ server, routes, plugins });
    app._rawExpressApp.use(app._rawExpressRouter);

    mutableIsInitialized = true;
    server.events.emit(':server', server);
  }

  const app: DeepWritable<TypeOfWebApp> = {
    _rawExpressApp: initApp(),
    events: server.events,

    async plugin(plugin) {
      const pluginDefinition = {
        name: plugin.name,
        value: await plugin.cb(app),
      };
      plugins.push(pluginDefinition);
      return app;
    },

    route(route) {
      validateRoute(route);
      routes.push(route);
      return app;
    },

    async inject(injection) {
      await initialize();

      let mutableTest = Supertest(app._rawExpressApp)[injection.method](injection.path);

      if (injection.payload) {
        mutableTest = mutableTest.send(injection.payload);
      }

      if (injection.headers) {
        mutableTest = Object.entries(injection.headers).reduce(
          (acc, [header, value]) => acc.set(header, value),
          mutableTest,
        );
      }

      const result = await mutableTest;
      return result;
    },

    async start() {
      await initialize();
      app._rawExpressServer = await listenExpressServer(app._rawExpressApp, options);

      Object.defineProperty(server, 'address', {
        get() {
          const address = app._rawExpressServer?.address();
          if (typeof address !== 'object' || !address) {
            return null;
          }

          const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;

          return new URL(`http://${host}:${address.port}`);
        },
      });

      return server;
    },

    stop() {
      return new Promise((resolve, reject) => {
        if (!app._rawExpressServer) {
          return resolve();
        }
        return app._rawExpressServer.stop((err) => {
          app._rawExpressServer = undefined;
          if (err) {
            return reject(err);
          }
          return resolve();
        });
      });
    },
  };

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- readonly
  return app as TypeOfWebApp;
}
