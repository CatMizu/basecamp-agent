import 'dotenv/config';

export interface Config {
  port: number;
  baseUri: string;
  nodeEnv: string;

  basecamp: {
    clientId: string;
    clientSecret: string;
  };

  userAgentContact: string;
  vaultDbPath: string;
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function loadConfig(): Config {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';

  return {
    port: Number(process.env.PORT) || 3232,
    baseUri: process.env.BASE_URI || 'http://localhost:3232',
    nodeEnv,

    basecamp: {
      // Allow these to be missing in dev so `npm run dev` can start without
      // them configured (tools will fail at call time with a clearer error);
      // require them in prod.
      clientId: isProd
        ? required('BASECAMP_CLIENT_ID', process.env.BASECAMP_CLIENT_ID)
        : process.env.BASECAMP_CLIENT_ID ?? '',
      clientSecret: isProd
        ? required('BASECAMP_CLIENT_SECRET', process.env.BASECAMP_CLIENT_SECRET)
        : process.env.BASECAMP_CLIENT_SECRET ?? '',
    },

    userAgentContact:
      process.env.USER_AGENT_CONTACT || 'ops@basecamp-mcp-server.example',
    vaultDbPath: process.env.VAULT_DB_PATH || './vault.db',
  };
}

export const config = loadConfig();
