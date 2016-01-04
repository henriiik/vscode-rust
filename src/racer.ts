import * as vscode from "vscode";
import * as cp from "child_process";

let itemKindMap = {
    "Function": vscode.CompletionItemKind.Function,
    "Module": vscode.CompletionItemKind.Module,
};

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

function makeDefinition(data: string[]): vscode.Definition {
    return new vscode.Location(vscode.Uri.file(data[4]), new vscode.Position(
        Number(data[2]) - 1,
        Number(data[3])
    ));
}

export class RustDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Definition> {
        return spawnRacer(document, position, "find-definition").then((child) => {
            return new Promise((resolve, reject) => {
                let root = vscode.workspace.rootPath + "/";
                let def: vscode.Definition = null;

                child.stdout.on("data", (data: Buffer) => {
                    let lines = data.toString().split("\n");
                    for (let line of lines) {
                        let data = line.split("\t");
                        if (data[0] === "MATCH") {
                            def = makeDefinition(data);
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
                        resolve(def);
                    }
                });
            });
        });
    }
}

function makeHover(data: string[]): vscode.Hover {
    return new vscode.Hover({
        language: "rust",
        value: data[6]
    });
}

export class RustHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Hover> {
        return spawnRacer(document, position, "find-definition").then((child) => {
            return new Promise((resolve, reject) => {
                let hover: vscode.Hover = null;

                child.stdout.on("data", (data: Buffer) => {
                    let lines = data.toString().split("\n");
                    for (let line of lines) {
                        let data = line.split("\t");
                        if (data[0] === "MATCH") {
                            hover = makeHover(data);
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
                        resolve(hover);
                    }
                });
            });
        });
    }
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

function countArgs(document: vscode.TextDocument, position: vscode.Position, caller: vscode.Position) {
    return document.getText(new vscode.Range(caller, position)).split(",").length - 1;
}

function makeSignature(data: string[]): vscode.SignatureInformation {
    let sign = data[6];
    console.log(sign);
    let params = sign.substring(
        sign.indexOf("(") + 1,
        sign.indexOf(")")
    ).split(",");

    let info = new vscode.SignatureInformation(sign);
    for (let param of params) {
        info.parameters.push(new vscode.ParameterInformation(param));
    }

    return info;
}

export class RustSignatureHelpProvider implements vscode.SignatureHelpProvider {
    provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.SignatureHelp> {
        let caller = findCaller(document, position);
        return spawnRacer(document, caller, "find-definition").then((child) => {
            return new Promise((resolve, reject) => {
                let help = new vscode.SignatureHelp();
                help.activeParameter = countArgs(document, position, caller);
                help.activeSignature = 0;

                child.stdout.on("data", (data: Buffer) => {
                    let lines = data.toString().split("\n");
                    for (let line of lines) {
                        let data = line.split("\t");
                        if (data[0] === "MATCH") {
                            help.signatures.push(makeSignature(data));
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
                        resolve(help);
                    }
                });
            });
        });
    }
}

