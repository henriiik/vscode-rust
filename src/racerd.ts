import * as cp from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {fsExists, fsWriteFile} from "./utils";

interface FileBuffer {
    contents: string;
    file_path: string;
}

interface RacerdRequest {
    buffers: FileBuffer[];
    column: number;
    file_path: string;
    line: number;
}

export interface RacerdDefinition {
    column: number;
    context: string;
    file_path: string;
    kind: string;
    line: number;
    text: string;
}

function makeQueryRequest(document: vscode.TextDocument, position: vscode.Position): RacerdRequest {
    return {
        buffers: [
            {
                file_path: document.uri.fsPath,
                contents: document.getText(),
            }
        ],
        file_path: document.uri.fsPath,
        line: position.line + 1,
        column: position.character,
    };
}

function doHmac(content: string, secret: string): Buffer {
    let hmac = crypto.createHmac("sha256", secret);
    hmac.update(content);
    return hmac.digest();
}

export class Racerd {
    child: cp.ChildProcess;
    hostname: string = "127.0.0.1";
    port: number = 0;
    secret: string;

    start() {
        let config = vscode.workspace.getConfiguration("rust.path");
        let racerdPath = config.get("racerd", "racerd");
        let rustSrcPath = config.get("rust-src", "");
        let secretPath = path.join(os.tmpdir(), "vscode-rust-" + process.pid);

        return fsExists(racerdPath)
            .then(() => {
                try {
                    this.secret = crypto.randomBytes(16).toString("base64");
                } catch (e) {
                    this.secret = crypto.pseudoRandomBytes(16).toString("base64");
                }

                return fsWriteFile(secretPath, this.secret);
            })
            .then(() => {
                this.child = cp.spawn(racerdPath, [
                    "serve",
                    "--secret-file",
                    secretPath,
                    "-p0",
                    "--rust-src-path",
                    rustSrcPath
                ]);
                this.child.stderr.on("data", data => {
                    console.error(data.toString());
                });

                this.child.stdout.on("data", (data: Buffer) => {
                    let out = data.toString();
                    let match = out.match(/racerd listening at 127.0.0.1:(\d+)/);
                    if (match) {
                        this.port = Number(match[1]);
                        this.child.stdout.removeAllListeners("data");
                    }
                    console.log(out);
                });

                this.child.on("close", (code, signal) => {
                    this.start();
                    console.error(code, signal);
                    vscode.window.showErrorMessage(`racerd crashed (${code}): ${signal}`);
                });
            })
            .catch(error => {
                vscode.window.showErrorMessage(`racerd error: ${error}`);
            });
    }

    stop() {
        if (this.child) {
            this.child.removeAllListeners("close");
            this.child.kill();
            this.child = null;
        }
    }

    restart() {
        this.stop();
        return this.start();
    }

    handleErrorResponse(response: http.IncomingMessage) {
        if (response.statusCode === 204) {
            return;
        } else if (response.statusCode === 500) {
            this.restart();
        }
        vscode.window.showErrorMessage(`${response.statusCode}: ${response.statusMessage}`);
        console.log(response);
    }

    sendRequest(method: string, path: string, body: string, callback: (res: http.IncomingMessage) => void): http.ClientRequest {
        let hmac = crypto.createHmac("sha256", this.secret);
        hmac.update(doHmac(method, this.secret));
        hmac.update(doHmac(path, this.secret));
        hmac.update(doHmac(body, this.secret));

        let options = {
            hostname: this.hostname,
            port: this.port,
            method: method,
            path: path,
            headers: {
                "Content-Type": "application/json",
                "Content-Length": body.length,
                "x-racerd-hmac": hmac.digest("hex")
            }
        };

        let request = http.request(options, callback);

        request.write(body, "utf8");
        request.end();

        return request;
    }

    sendQuery(path: string, document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<RacerdDefinition[]> {
        if (!this.child) {
            return null;
        }

        return new Promise<RacerdDefinition[]>((resolve, reject) => {
            let body = JSON.stringify(makeQueryRequest(document, position));
            let request = this.sendRequest("POST", path, body, response => {
                if (response.statusCode !== 200) {
                    reject();
                    this.handleErrorResponse(response);
                    return;
                } else if (token.isCancellationRequested) {
                    reject();
                }

                let data = "";

                response.setEncoding("utf8");
                response.on("data", (chunk: Buffer) => {
                    data += chunk.toString();
                });

                response.on("end", () => {
                    let parsed = JSON.parse(data);
                    if (Array.isArray(parsed)) {
                        resolve(parsed);
                    } else {
                        resolve([parsed]);
                    }
                    console.log(parsed);
                });
            });

            request.on("error", (error) => {
                reject();
                console.log(`problem with request: ${error.message}`);
            });

            token.onCancellationRequested(() => request.abort());
        });
    }

    complete(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<RacerdDefinition[]> {
        return this.sendQuery("/list_completions", document, position, token);
    }

    define(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<RacerdDefinition> {
        return this.sendQuery("/find_definition", document, position, token).then(matches => matches[0]);
    }
}
