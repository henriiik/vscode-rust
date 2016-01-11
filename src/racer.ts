import * as vscode from "vscode";
import * as cp from "child_process";

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

function showRacerError(code: Number, stdout: string, stderr: string) {
    let message = stdout || stderr;
    vscode.window.showErrorMessage(`Racer failed (${code}): ${message}`);
}

interface RacerDefinition {
    name: string;
    line: number;
    character: number;
    file: string;
    type: string;
    context: string;
}

export class Racer {
    child: cp.ChildProcess;
    lastRun: Promise<RacerDefinition[]>;

    constructor() {
        this.lastRun = new Promise(resolve => resolve([]));
        this.start();
    }

    start() {
        let config = vscode.workspace.getConfiguration("rust.path");
        this.child = cp.spawn(config.get("racer", "racer"), [
            "--interface",
            "tab-text",
            "daemon",
        ]);
        this.child.on("close", (code, signal) => {
            console.error(code, signal);
            vscode.window.showErrorMessage(`Racer failed (${code}): ${signal}`);
            this.lastRun = new Promise(resolve => resolve([]));
            this.start();
        });
    }

    stop() {
        this.child.removeAllListeners("close");
        this.child.kill();
    }

    run(document: vscode.TextDocument, position: vscode.Position, command: string): Promise<RacerDefinition[]> {
        this.lastRun = this.lastRun.catch(e => {}).then(() => {
            return new Promise<RacerDefinition[]>((resolve, reject) => {
                let child = this.child;
                let stdout = "";
                let stderr = "";

                let cmd = [
                    command,
                    String(position.line + 1),
                    String(position.character),
                    document.fileName,
                    "-"
                ].join("\t");

                console.log(cmd);

                child.stdin.write(cmd);
                child.stdin.write("\n");
                child.stdin.write(document.getText());
                child.stdin.write("\x04");

                function stderrListener(data: Buffer) {
                    console.error("ERROR!!");
                    console.error(data.toString());
                    child.stderr.removeListener("data", stderrListener);
                    child.stdout.removeListener("data", stdoutListener);
                    reject(null);
                }

                function stdoutListener(data: Buffer) {
                    console.log("DATA!!");
                    console.log(data.toString());
                    stdout += data.toString();
                    if (stdout.endsWith("END\n")) {
                        child.stderr.removeListener("data", stderrListener);
                        child.stdout.removeListener("data", stdoutListener);
                        let matches: RacerDefinition[] = [];
                        let lines = stdout.split("\n");
                        let length = lines.length - 2; // skip last END and empty line;
                        let count = 0;
                        while (count < length) {
                            let data = lines[count].split("\t");
                            count += 1;
                            if (data[0] === "MATCH") {
                                let match = {
                                    name: data[1],
                                    line: Number(data[2]),
                                    character: Number(data[3]),
                                    file: data[4],
                                    type: data[5],
                                    context: data.slice(6).join(),
                                };
                                while (count < length && !lines[count].startsWith("MATCH")) {
                                    match.context += lines[count];
                                    count += 1;
                                }
                                matches.push(match);
                            }
                        }
                        resolve(matches);
                    }
                };

                child.stdout.on("data", stdoutListener);
                child.stderr.on("data", stderrListener);
            });
        });

        return this.lastRun;
    }

    complete(document: vscode.TextDocument, position: vscode.Position): Promise<RacerDefinition[]> {
        return this.run(document, position, "complete");
    }

    define(document: vscode.TextDocument, position: vscode.Position): Promise<RacerDefinition> {
        return this.run(document, position, "find-definition").then(matches => matches[0]);
    }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.CompletionItem[]> {
        return this.complete(document, position).then(matches => {
            return matches.map(makeCompletionItem);
        });
    }

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Definition> {
        return this.define(document, position).then(makeDefinition);
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover> {
        return this.define(document, position).then(makeHover);
    }

    provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.SignatureHelp> {
        let caller = findCaller(document, position);
        let skipFirst = isMethodCall(document, caller);
        return this.define(document, caller).then((definition) => {
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

// CompletionProvider Helpers

function makeCompletionItem(definition: RacerDefinition): vscode.CompletionItem {
    let item = new vscode.CompletionItem(definition.name);
    item.kind = itemKindMap[definition.type];
    item.detail = definition.context;
    item.documentation = definition.file;
    return item;
}

// DefinitionProvider Helpers

function makeDefinition(definition: RacerDefinition): vscode.Definition {
    return new vscode.Location(vscode.Uri.file(definition.file), new vscode.Position(
        definition.line - 1,
        definition.character
    ));
}

// HoverProvider Helpers

function makeHover(definition: RacerDefinition): vscode.Hover {
    return new vscode.Hover({
        language: "rust",
        value: `(${definition.type}) ${definition.context.replace(/\s+/g, " ")}`
    });
}

// SignatureHelpProvider Helpers

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

function makeSignature(definition: RacerDefinition, skipFirst: boolean): vscode.SignatureInformation {
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
