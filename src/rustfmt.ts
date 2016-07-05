import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import {RUST_MODE} from "./utils";

let errorRegex = /(\w+):(\d+):(\d+):\s(\d+):(\d+)\s(\w+):\s(.*)/g;
let warningRegex = /Rustfmt failed at stdin:(\d+):\s(.*)/g;

export class FormattingProvider implements vscode.DocumentFormattingEditProvider {
    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(RUST_MODE, this));
    }

    provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Thenable<vscode.TextEdit[]> {
        return new Promise<vscode.TextEdit[]>((resolve, reject) => {
            let collection = vscode.languages.createDiagnosticCollection("Rust");
            collection.clear();

            let child = cp.spawn("rustfmt", [], {
                cwd: path.dirname(document.fileName)
            });
            child.stdin.write(document.getText());
            child.stdin.end();

            let formatted = "";
            child.stdout.on("data", (data: Buffer) => {
                formatted += data.toString();
            });

            let diagnostics: vscode.Diagnostic[] = [];
            child.stderr.on("data", (data: Buffer) => {
                let output = data.toString();
                let message: RegExpExecArray;
                while (message = errorRegex.exec(output)) {
                    diagnostics.push(formatError(message));
                }
                while (message = warningRegex.exec(output)) {
                    diagnostics.push(formatWarning(message));
                }
            });

            child.on("close", (code) => {
                if (code ==  3) {
                    collection.set(document.uri, diagnostics);
                    vscode.window.showWarningMessage("Formatted with warnings.");
                } else if (code > 0) {
                    collection.set(document.uri, diagnostics);
                    vscode.window.showErrorMessage("Could not format file.");
                }

                if (code == 0 || code == 3) {
                    let range = new vscode.Range(
                        0,
                        0,
                        document.lineCount - 1,
                        Number.MAX_VALUE
                    );
                    resolve([new vscode.TextEdit(range, formatted)]);
                } else {
                    reject(null);
                }
            });
        });
    }
}

function formatError(message: RegExpExecArray): vscode.Diagnostic {
    return new vscode.Diagnostic(
        new vscode.Range(
            Number(message[2]) - 1,
            Number(message[3]),
            Number(message[4]) - 1,
            Number(message[5])
        ),
        message[7],
        vscode.DiagnosticSeverity.Error
    );
}

function formatWarning(message: RegExpExecArray): vscode.Diagnostic {
    return new vscode.Diagnostic(
        new vscode.Range(
            Number(message[1]) - 1,
            0,
            Number(message[1]) - 1,
            Number.MAX_VALUE
        ),
        message[2],
        vscode.DiagnosticSeverity.Warning
    )
}