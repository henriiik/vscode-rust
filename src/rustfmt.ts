import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";

let errorRegex = /(\w+):(\d+):(\d+):\s(\d+):(\d+)\s(\w+):\s(.*)/g;

export class RustDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
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
                    diagnostics.push(formatMessage(message));
                }
            });

            child.on("close", (code) => {
                if (code > 0) {
                    collection.set(document.uri, diagnostics);
                    vscode.window.showErrorMessage("Could not format file.");
                    reject(null);
                } else {
                    let range = new vscode.Range(
                        0,
                        0,
                        document.lineCount - 1,
                        Number.MAX_VALUE
                    );
                    resolve([new vscode.TextEdit(range, formatted)]);
                }
            });
        });
    }
}

function formatMessage(message: RegExpExecArray): vscode.Diagnostic {
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