import * as cp from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

let itemKindMap = {
    "Const": vscode.CompletionItemKind.Variable,
    "Crate": vscode.CompletionItemKind.Module,
    "Enum": vscode.CompletionItemKind.Enum,
    "EnumVariant": vscode.CompletionItemKind.Enum,
    "FnArg": vscode.CompletionItemKind.Variable,
    "For": vscode.CompletionItemKind.Variable,
    "Function": vscode.CompletionItemKind.Function,
    "IfLet": vscode.CompletionItemKind.Variable,
    "Impl": vscode.CompletionItemKind.Interface,
    "Let": vscode.CompletionItemKind.Variable,
    "MatchArm": vscode.CompletionItemKind.Value,
    "Module": vscode.CompletionItemKind.Module,
    "Static": vscode.CompletionItemKind.Variable,
    "Struct": vscode.CompletionItemKind.Class,
    "StructField": vscode.CompletionItemKind.Field,
    "Trait": vscode.CompletionItemKind.Interface,
    "Type": vscode.CompletionItemKind.Interface,
    "WhileLet": vscode.CompletionItemKind.Variable,
};

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

interface RacerdDefinition {
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

function makeCompletionItem(definition: RacerdDefinition): vscode.CompletionItem {
    let item = new vscode.CompletionItem(definition.text);
    item.kind = itemKindMap[definition.kind];
    item.detail = definition.context;
    item.documentation = definition.file_path;
    return item;
}

function makeDefinition(definition: RacerdDefinition): vscode.Definition {
    return new vscode.Location(vscode.Uri.file(definition.file_path), new vscode.Position(
        definition.line - 1,
        definition.column
    ));
}

function makeHover(definition: RacerdDefinition): vscode.Hover {
    return new vscode.Hover({
        language: "rust",
        value: `(${definition.kind}) ${definition.context.replace(/\s+/g, " ")}`
    });
}

function findCaller(document: vscode.TextDocument, position: vscode.Position): vscode.Position {
    let offset = document.offsetAt(position);
    let text = document.getText(new vscode.Range(0, 0, position.line, position.character));

    let depth = 1;
    while (offset > 0 && depth > 0) {
        offset -= 1;

        let c = text.charAt(offset);
        if (c === "(") {
            depth -= 1;
        } else if (c === ")") {
            depth += 1;
        }
    }

    return document.positionAt(offset);
}

function isMethodCall(document: vscode.TextDocument, caller: vscode.Position): boolean {
    let callerRange = document.getWordRangeAtPosition(caller);
    let prefixRange = new vscode.Range(
        callerRange.start.line,
        callerRange.start.character - 1,
        callerRange.start.line,
        callerRange.start.character
    );
    return document.getText(prefixRange) === ".";
}

function countArgs(document: vscode.TextDocument, position: vscode.Position, caller: vscode.Position) {
    return document.getText(new vscode.Range(caller, position)).split(",").length - 1;
}

function makeSignature(definition: RacerdDefinition, skipFirst: boolean): vscode.SignatureInformation {
    let signature = definition.context;
    let params = signature.substring(
        signature.indexOf("(") + 1,
        signature.indexOf(")")
    ).split(",");

    let info = new vscode.SignatureInformation(signature);

    if (skipFirst) {
        params = params.slice(1);
    }

    for (let param of params) {
        info.parameters.push(new vscode.ParameterInformation(param.trim()));
    }

    return info;
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

    constructor() {
        this.start();
    }

    start() {
        let config = vscode.workspace.getConfiguration("rust.path");
        let secretPath = path.join(os.tmpdir(), "vscode-rust-" + process.pid);

        try {
            this.secret = crypto.randomBytes(16).toString("base64");
        } catch (e) {
            this.secret = crypto.pseudoRandomBytes(16).toString("base64");
        }

        fs.writeFileSync(secretPath, this.secret);

        this.child = cp.spawn(config.get("racerd", "racerd"), [
            "serve",
            "--secret-file",
            secretPath,
            "-p0",
            "--rust-src-path",
            config.get("rust-src", "")
        ]);

        this.child.stderr.on("data", data => {
            console.error(data.toString());
        });

        this.child.stdout.on("data", (data: Buffer) => {
            let match = data.toString().match(/racerd listening at 127.0.0.1:(\d+)/);
            if (match) {
                this.port = Number(match[1]);
                this.child.stdout.removeAllListeners("data");
            }
        });

        this.child.on("close", (code, signal) => {
            this.start();
            console.error(code, signal);
            vscode.window.showErrorMessage(`Racerd failed (${code}): ${signal}`);
        });
    }

    stop() {
        this.child.removeAllListeners("close");
        this.child.kill();
    }

    handleErrorResponse(response: http.IncomingMessage) {
        if (response.statusCode === 204) {
            return;
        } else if (response.statusCode === 500) {
            this.stop();
            this.start();
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

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.CompletionItem[]> {
        return this.complete(document, position, token).then(matches => matches.map(makeCompletionItem));
    }

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Definition> {
        return this.define(document, position, token).then(makeDefinition);
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover> {
        return this.define(document, position, token).then(makeHover);
    }

    provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.SignatureHelp> {
        let caller = findCaller(document, position);
        let skipFirst = isMethodCall(document, caller);
        return this.define(document, caller, token).then(definition => {
            if (caller.line === (definition.line - 1)) {
                return null;
            }
            let help = new vscode.SignatureHelp();
            help.activeParameter = countArgs(document, position, caller);
            help.activeSignature = 0;
            help.signatures.push(makeSignature(definition, skipFirst));
            return help;
        });
    };
}
