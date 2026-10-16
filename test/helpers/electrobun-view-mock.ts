// Global stand-in for `electrobun/view`, installed by test/setup.ts. The
// real `src/view/rpc.ts` runs on top of it; tests swap the backing FakeMain.
import type { FakeMain } from './fake-main';

type RpcConfig = {
  maxRequestTime?: number;
  handlers: {
    requests: Record<string, (params: unknown) => unknown>;
    messages: Record<string, (payload: unknown) => unknown>;
  };
};

export const viewMockState: {
  fake: FakeMain | null;
  config: RpcConfig | null;
  instances: unknown[];
} = {
  fake: null,
  config: null,
  instances: [],
};

export function setFakeMain(fake: FakeMain) {
  viewMockState.fake = fake;
}

function current(): FakeMain {
  if (!viewMockState.fake) {
    throw new Error('no FakeMain installed; call setFakeMain() in the test');
  }
  return viewMockState.fake;
}

export class FakeElectroview {
  static defineRPC(config: RpcConfig) {
    viewMockState.config = config;
    return {
      request: new Proxy({} as Record<string, (params: unknown) => Promise<unknown>>, {
        get: (_target, name: string) => (params: unknown) => {
          const fn = current().main.request[name];
          if (!fn) {
            return Promise.reject(new Error(`fake main has no request ${name}`));
          }
          return fn(params as never);
        },
      }),
      send: new Proxy({} as Record<string, (payload: unknown) => void>, {
        get: (_target, name: string) => (payload: unknown) => {
          const fake = current();
          fake.sent.push({ name, payload });
          if (name === 'log') {
            const { level, message } = payload as {
              level: string;
              message: string;
            };
            fake.logs.push(`${level}:${message}`);
          }
        },
      }),
    };
  }

  constructor(options: unknown) {
    viewMockState.instances.push(options);
  }
}

export const electrobunViewMock = () => ({ Electroview: FakeElectroview });
