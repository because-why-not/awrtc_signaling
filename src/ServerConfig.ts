export class ServerConfig {
  log_verbose: boolean;
  adminToken: string | null;
  httpConfig?: HttpConfig;
  httpsConfig?: HttpsConfig;
  maxPayload: number;
  apps: AppConfig[];
}
export class HttpConfig {
  port: number;
  host: string;
}

export class HttpsConfig {
  port: number;
  host: string;
  ssl_key_file: string;
  ssl_cert_file: string;
}

export class AppConfig {
  name: string;
  path: string;
  address_sharing?: boolean;
}

export function validatePort(value: string): number {
  const port = parseInt(value);

  if (isNaN(port)) {
    throw new Error(`Invalid port: '${value}' is not a number`);
  }

  if (port <= 0 || port > 65535) {
    throw new Error(`Invalid port: '${port}' is out of valid range (1–65535)`);
  }

  return port;
}
