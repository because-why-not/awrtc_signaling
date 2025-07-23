import { SLogger } from "../src/Logger";

export class TestHelper {
    private static sLogger = new SLogger("test");
    static get logger(): SLogger {
        return this.sLogger;
    }
}