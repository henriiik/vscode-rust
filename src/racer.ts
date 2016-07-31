import * as cp from "child_process";
import * as vscode from "vscode";
import {fsExists, fsWriteFile} from "./utils";

export interface RacerDefinition {
    column: number;
    context: string;
    file_path: string;
    kind: string;
    line: number;
    text: string;
}

export class Racer {
    complete(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<RacerDefinition[]> {
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
                            column: Number(match[1]),
                            context: match.slice(5).join(),
                            file_path: match[3],
                            kind: match[4],
                            line: Number(match[2]),
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

    define(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<RacerDefinition> {
        return this.complete(document, position, token).then(matches => matches[0]);
    }
}