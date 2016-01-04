import * as vscode from "vscode";
import * as cp from "child_process";

let itemKindMap = {
    "Function": vscode.CompletionItemKind.Function,
    "Module": vscode.CompletionItemKind.Module,
};

function showRacerError(code: Number, stdout: string[], stderr: string[]) {
    let message = stdout[0] || stderr[0];
    vscode.window.showErrorMessage(`Racer failed (${code}): ${stdout[0] || stderr[0]}`);
}

interface RacerDefinition {
    name: string;
    line: number;
    character: number;
    file: string;
    type: string;
    context: string;
}

function spawnRacer(document: vscode.TextDocument, position: vscode.Position, command: string): Thenable<cp.ChildProcess> {
    return document.save().then(() => {
        return cp.spawn("racer", [
            "--interface",
            "tab-text",
            command,
            String(position.line + 1),
            String(position.character),
            document.fileName
        ]);
    });
}

function parseDefinition(match: string[]): RacerDefinition {
    return {
        name: match[1],
        line: Number(match[2]),
        character: Number(match[3]),
        file: match[4],
        type: match[5],
        context: match[6],
    };
}

function racerRun(document: vscode.TextDocument, position: vscode.Position, command: string) {
    return spawnRacer(document, position, command).then((child) => {
        return new Promise((resolve, reject) => {
            let matches: string[][] = [];

            let stdout = [];
            child.stdout.on("data", (data: Buffer) => {
                let lines = data.toString().split("\n");
                stdout = stdout.concat(lines);
                for (let line of lines) {
                    let data = line.split("\t");
                    if (data[0] === "MATCH") {
                        matches.push(data);
                    }
                }
            });

            let stderr = [];
            child.stderr.on("data", (data: Buffer) => {
                stdout = stdout.concat(data.toString().split("\n"));
            });

            child.on("close", (code) => {
                if (code > 0) {
                    let debug = {
                        code,
                        stdout,
                        stderr
                    };
                    console.log(debug);
                    showRacerError(code, stdout, stderr);
                    reject(debug);
                } else {
                    resolve(matches);
                }
            });
        });
    });
}

function racerFindDefinition(document: vscode.TextDocument, position: vscode.Position): Thenable<RacerDefinition> {
    return racerRun(document, position, "find-definition").then(matches => {
        return parseDefinition(matches[0]);
    });
}

function makeCompletionItem(data: string[], root: string): vscode.CompletionItem {
    let item = new vscode.CompletionItem(data[1]);
    item.kind = itemKindMap[data[6]];
    item.detail = data[5].replace(root, "");
    item.documentation = data[7];
    return item;
}

export class RustCompletionItemProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.CompletionItem[]> {
        return spawnRacer(document, position, "complete-with-snippet").then((child) => {
            return new Promise((resolve, reject) => {
                let root = vscode.workspace.rootPath + "/";
                let items = [];

                child.stdout.on("data", (data: Buffer) => {
                    let lines = data.toString().split("\n");
                    for (let line of lines) {
                        let data = line.split("\t");
                        if (data[0] === "MATCH") {
                            items.push(makeCompletionItem(data, root));
                        }
                    }
                });

                let stderr = "";
                child.stderr.on("data", (data: Buffer) => {
                    stderr += data.toString();
                });

                child.on("close", (code) => {
                    if (code > 0) {
                        reject(null);
                    } else {
                        resolve(items);
                    }
                });

            });
        });
    }
}

// DefinitionProvider

function makeDefinition(definition: RacerDefinition): vscode.Definition {
    return new vscode.Location(vscode.Uri.file(definition.file), new vscode.Position(
        definition.line - 1,
        definition.character
    ));
}

export class RustDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Definition> {
        return racerFindDefinition(document, position).then(makeDefinition);
    }
}

// HoverProvider

function makeHover(definition: RacerDefinition): vscode.Hover {
    // TODO: fix better info for not functions
    return new vscode.Hover({
        language: "rust",
        value: definition.context
    });
}

export class RustHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Hover> {
        return racerFindDefinition(document, position).then(makeHover);
    }
}

// SignatureHelpProvider

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

function countArgs(document: vscode.TextDocument, position: vscode.Position, caller: vscode.Position) {
    return document.getText(new vscode.Range(caller, position)).split(",").length - 1;
}

function makeSignature(definition: RacerDefinition): vscode.SignatureInformation {
    let signature = definition.context;
    let params = signature.substring(
        signature.indexOf("(") + 1,
        signature.indexOf(")")
    ).split(",");

    let info = new vscode.SignatureInformation(signature);

    for (let param of params) {
        info.parameters.push(new vscode.ParameterInformation(param));
    }

    return info;
}

export class RustSignatureHelpProvider implements vscode.SignatureHelpProvider {
    provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.SignatureHelp> {
        let caller = findCaller(document, position);
        return racerFindDefinition(document, caller).then((definition) => {
            let help = new vscode.SignatureHelp();
            help.activeParameter = countArgs(document, position, caller);
            help.activeSignature = 0;
            help.signatures.push(makeSignature(definition));
            return help;
        });
    };
}

