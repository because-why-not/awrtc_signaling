import http from "http";
import url from "url";

export interface UserTokens {
  [key: string]: NodeJS.Timeout;
}

export interface UserTokenRequest {
  userToken: string;
  timeout: number;
}

export class TokenManager {
  userTokens: UserTokens = {};
  adminToken: string = null;
  verboseLog = false;

  constructor(adminToken: string, verboseLog: boolean) {
    this.adminToken = adminToken;
    this.verboseLog = verboseLog;
  }

  public isActive(): boolean {
    if (this.adminToken && typeof this.adminToken === "string") return true;
    return false;
  }

  public isValidUserTokenRequest = (
    obj: UserTokenRequest,
  ): obj is UserTokenRequest => {
    return (
      typeof obj === "object" &&
      obj !== null &&
      typeof obj.userToken === "string" &&
      typeof obj.timeout === "number" &&
      obj.timeout >= 0
    );
  };

  private processUserTokenRequest(request: UserTokenRequest) {
    const { userToken, timeout } = request;

    //if we already have an active token we stop the timeout to trigger cleanup
    if (this.userTokens[userToken]) {
      clearTimeout(this.userTokens[userToken]);
    }

    // Add token and set a timeout to remove the token after the specified time
    this.userTokens[userToken] = setTimeout(() => {
      delete this.userTokens[userToken];
      if (this.verboseLog)
        console.log(
          `Token ${userToken} has been removed after ${timeout} seconds`,
        );
    }, timeout * 1000);
  }

  public processRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method === "POST" || req.method === "GET") {
      if (req.headers["authorization"] === this.adminToken) {
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (this.verboseLog) console.log("Admin request received: ", body);
          try {
            const obj = JSON.parse(body) as UserTokenRequest;

            if (this.isValidUserTokenRequest(obj)) {
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              this.processUserTokenRequest(obj);
              res.end(JSON.stringify({ secret: "This is super secret info!" }));
            } else {
              res.statusCode = 400;
              const err = "Bad Request: Invalid UserTokenRequest format";
              console.error(err);
              res.end(err);
            }
          } catch (e) {
            let errMsg: string;
            if (e instanceof Error) {
              errMsg = "Error parsing or processing input: " + e.message;
            } else {
              errMsg = "Non-error thrown: " + JSON.stringify(e);
            }
            res.statusCode = 500;
            const err = "Error parsing or processing input:" + errMsg;
            console.error(err, e);
            res.end(err);
          }
        });
      } else {
        res.statusCode = 401;
        const err = "Unauthorized";
        console.error(err);
        res.end(err);
      }
    } else {
      res.statusCode = 405;
      const err = "Method Not Allowed: " + req.method;
      console.error(err);
      res.end(err);
    }
  }

  public checkUserToken = (req: http.IncomingMessage): boolean => {
    if (!this.isActive()) return true;
    const parameters = url.parse(req.url, true).query;
    const token = parameters.userToken as string;
    if (this.userTokens[token]) return true;
    return false;
  };
}
