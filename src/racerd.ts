import * as vscode from "vscode";
import * as cp from "child_process";
import * as http from "http";

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

export class Racerd {
    child: cp.ChildProcess;
    hostname: string = "127.0.0.1";
    port: number = 0;

    constructor() {
        this.start();
    }

    start() {
        let config = vscode.workspace.getConfiguration("rust.path");

        this.child = cp.spawn(config.get("racerd", "racerd"), [
            "serve",
            "-l",
            "-p0",
            "--rust-src-path",
            config.get("rust-src", "")
        ]);

        this.child.stdout.on("data", (data: Buffer) => {
            let match = data.toString().match(/racerd listening at 127.0.0.1:(\d+)/);
            if (match) {
                this.port = Number(match[1]);
                this.child.stdout.removeAllListeners("data");
            }
            console.log(match);
        });

        this.child.on("close", (code, signal) => {
            this.start();
            console.error(code, signal);
            vscode.window.showErrorMessage(`Racer failed (${code}): ${signal}`);
        });
    }

    stop() {
        this.child.removeAllListeners("close");
        this.child.kill();
    }

    handleErrorResponse(response: http.IncomingMessage) {
        if (response.statusCode === 204) {
            return;
        }
        vscode.window.showErrorMessage(`${response.statusCode}: ${response.statusMessage}`)
        console.log(response);
    }

    run(command: string, document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<RacerdDefinition[]> {
        return new Promise<RacerdDefinition[]>((resolve, reject) => {
            let content = JSON.stringify(makeQueryRequest(document, position));

            let options = {
                hostname: this.hostname,
                port: this.port,
                method: "POST",
                path: command,
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": content.length
                }
            };

            let request = http.request(options, response => {
                console.log(`STATUS: ${response.statusCode}`);
                console.log(`HEADERS: ${JSON.stringify(response.headers)}`);

                if (response.statusCode !== 200) {
                    reject();
                    this.handleErrorResponse(response);
                    return;
                }

                let data = "";

                response.setEncoding("utf8");
                response.on("data", chunk => {
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

            request.on("error", (e) => {
                reject();
                console.log(`problem with request: ${e.message}`);
            });

            request.write(content);
            request.end();
        });
    }

    complete(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<RacerdDefinition[]> {
        return this.run("/list_completions", document, position, token);
    }

    define(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<RacerdDefinition> {
        return this.run("/find_definition", document, position, token).then(matches => matches[0]);
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
