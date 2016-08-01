import * as vscode from "vscode";
import * as cp from "child_process";
import {RUST_MODE} from "./utils";

export interface RacerDefinition {
    column: number;
    context: string;
    file_path: string;
    kind: string;
    line: number;
    text: string;
}

let itemKindMap = {
    Const: vscode.CompletionItemKind.Variable,
    Crate: vscode.CompletionItemKind.Module,
    Enum: vscode.CompletionItemKind.Enum,
    EnumVariant: vscode.CompletionItemKind.Enum,
    FnArg: vscode.CompletionItemKind.Variable,
    For: vscode.CompletionItemKind.Variable,
    Function: vscode.CompletionItemKind.Function,
    IfLet: vscode.CompletionItemKind.Variable,
    Impl: vscode.CompletionItemKind.Interface,
    Let: vscode.CompletionItemKind.Variable,
    MatchArm: vscode.CompletionItemKind.Value,
    Module: vscode.CompletionItemKind.Module,
    Static: vscode.CompletionItemKind.Variable,
    Struct: vscode.CompletionItemKind.Class,
    StructField: vscode.CompletionItemKind.Field,
    Trait: vscode.CompletionItemKind.Interface,
    Type: vscode.CompletionItemKind.Interface,
    WhileLet: vscode.CompletionItemKind.Variable,
};

function makeCompletionItem(definition: RacerDefinition): vscode.CompletionItem {
    let item = new vscode.CompletionItem(definition.text);
    item.kind = itemKindMap[definition.kind];
    item.detail = definition.context;
    item.documentation = definition.file_path.replace(vscode.workspace.rootPath + "/", "");
    return item;
}

function makeDefinition(definition: RacerDefinition): vscode.Definition {
    return new vscode.Location(vscode.Uri.file(definition.file_path), new vscode.Position(
        definition.line - 1,
        definition.column
    ));
}

function makeHover(definition: RacerDefinition): vscode.Hover {
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

function complete(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<RacerDefinition[]> {
    return new Promise((resolve, reject) => {
        let config = vscode.workspace.getConfiguration("rust.path");
        let racerPath = config.get("racer", "racer");
        let rustSrcPath = config.get("rust-src", "");

        let line = position.line + 1;
        let char = position.character;
        let path = document.uri.fsPath;

        let child = cp.spawn(racerPath, [
            "-i",
            "text",
            "complete",
            line.toString(),
            char.toString(),
            path.toString(),
            "-"
        ]);

        child.stdin.write(document.getText());
        child.stdin.end();

        let matches: RacerDefinition[] = [];

        child.stdout.on("data", (data: Buffer) => {
            let out = data.toString();
            for (let line of out.split("\n")) {
                if (line.startsWith("MATCH ")) {
                    let match = line.split(",");
                    matches.push({
                        column: Number(match[2]),
                        context: match.slice(5).join(),
                        file_path: match[3],
                        kind: match[4],
                        line: Number(match[1]),
                        text: match[0].substr(6),
                    });
                    console.log(match);
                }
            }
        });

        child.stderr.on("data", (data: Buffer) => {
            let out = data.toString();
            console.error(out);
        });

        child.on("close", (code) => {
            resolve(matches);
        });
    });
}

function define(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<RacerDefinition> {
    return complete(document, position, token).then(matches => matches[0]);
}

export class Racer {
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.CompletionItem[]> {
        return complete(document, position, token).then(matches => matches.map(makeCompletionItem));
    }

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Definition> {
        return define(document, position, token).then(makeDefinition);
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover> {
        return define(document, position, token).then(makeHover);
    }

    provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.SignatureHelp> {
        let caller = findCaller(document, position);
        let skipFirst = isMethodCall(document, caller);
        return define(document, caller, token).then(definition => {
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