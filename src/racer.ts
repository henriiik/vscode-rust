import * as vscode from "vscode";
import * as cp from "child_process";

let itemKindMap = {
    "Function": vscode.CompletionItemKind.Function,
    "Module": vscode.CompletionItemKind.Module,
};

export class RustCompletionItemProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.CompletionItem[]> {
        return document.save().then(() => {
            return new Promise((resolve, reject) => {
                let root = vscode.workspace.rootPath + "/";
                let items = [];

                let child = cp.spawn("racer", ["--interface", "tab-text", "complete-with-snippet", String(position.line + 1), String(position.character), document.fileName]);
                child.stdin.write(document.getText());
                child.stdin.end();

                child.stdout.on("data", (data: Buffer) => {
                    let lines = data.toString().split("\n");
                    let prefix = "";
                    for (var line of lines) {
                        let data = line.split("\t");
                        if (data[0] === "PREFIX") {
                            prefix = data[3];
                        } else if (data[0] === "MATCH") {
                            let item = new vscode.CompletionItem(data[1]);
                            item.kind = itemKindMap[data[6]];
                            item.detail = data[5].replace(root, "");
                            item.documentation = data[7];
                            items.push(item);
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


export class RustDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Definition> {
        return document.save().then(() => {
            return new Promise((resolve, reject) => {
                let root = vscode.workspace.rootPath + "/";
                let def: vscode.Definition = null;

                let child = cp.spawn("racer", ["--interface", "tab-text", "find-definition", String(position.line + 1), String(position.character), document.fileName]);
                child.stdin.write(document.getText());
                child.stdin.end();

                child.stdout.on("data", (data: Buffer) => {
                    let lines = data.toString().split("\n");
                    let prefix = "";
                    for (var line of lines) {
                        let data = line.split("\t");
                        if (data[0] === "PREFIX") {
                            prefix = data[3];
                        } else if (data[0] === "MATCH") {
                            def = new vscode.Location(vscode.Uri.file(data[4]), new vscode.Position(
                                Number(data[2]) - 1,
                                Number(data[3])
                            ));
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