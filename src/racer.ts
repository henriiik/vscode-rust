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

function racerRun(document: vscode.TextDocument, position: vscode.Position, command: string): Thenable<RacerDefinition[]> {
    return document.save().then(() => {
        return new Promise<RacerDefinition[]>((resolve, reject) => {
            let matches: RacerDefinition[] = [];

            let child = cp.spawn("racer", [
                "--interface",
                "tab-text",
                command,
                String(position.line + 1),
                String(position.character),
                document.fileName
            ]);

            let stdout = [];
            child.stdout.on("data", (data: Buffer) => {
                let lines = data.toString().split("\n");
                stdout = stdout.concat(lines);
                for (let line of lines) {
                    let data = line.split("\t");
                    if (data[0] === "MATCH") {
                        matches.push({
                            name: data[1],
                            line: Number(data[2]),
                            character: Number(data[3]),
                            file: data[4],
                            type: data[5],
                            context: data[6],
                        });
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

function racerComplete(document: vscode.TextDocument, position: vscode.Position): Thenable<RacerDefinition[]> {
    return racerRun(document, position, "complete");
}

function racerDefinition(document: vscode.TextDocument, position: vscode.Position): Thenable<RacerDefinition> {
    return racerRun(document, position, "find-definition").then(matches => matches[0]);
}

// Completion Provider

function makeCompletionItem(definition: RacerDefinition): vscode.CompletionItem {
    let item = new vscode.CompletionItem(definition.name);
    item.kind = itemKindMap[definition.type];
    item.detail = definition.context;
    item.documentation = definition.file;
    return item;
}

export class RustCompletionItemProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.CompletionItem[]> {
        return racerComplete(document, position).then(matches => {
            return matches.map(makeCompletionItem);
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
        return racerDefinition(document, position).then(makeDefinition);
    }
}

// HoverProvider

function makeHover(definition: RacerDefinition): vscode.Hover {
    return new vscode.Hover({
        language: "rust",
        value: `(${definition.type}) ${definition.context}`
    });
}

export class RustHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Hover> {
        return racerDefinition(document, position).then(makeHover);
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
        return racerDefinition(document, caller).then((definition) => {
            let help = new vscode.SignatureHelp();
            help.activeParameter = countArgs(document, position, caller);
            help.activeSignature = 0;
            help.signatures.push(makeSignature(definition));
            return help;
        });
    };
}

