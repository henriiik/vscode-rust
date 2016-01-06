import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

let problemMatcher = [
    {
        "owner": "rust",
        "pattern": {
            "regexp": "^(.+):(\\d+):(\\d+):\\s*(\\d+):(\\d+)\\s(\\w+):\\s*(.+)",
            "file": 1,
            "line": 2,
            "column": 3,
            "endLine": 4,
            "endColumn": 5,
            "severity": 6,
            "message": 7
        }
    },
    {
        "owner": "rust",
        "pattern": {
            "regexp": "^(.*panicked.*),\\s*(.+):(\\d+)$",
            "message": 1,
            "file": 2,
            "line": 3,
            "column": 0
        }
    }
];

let tasks = {
    "version": "0.1.0",
    "command": "cargo",
    "isShellCommand": true,
    "showOutput": "always",
    "echoCommand": true,
    "tasks": [
        {
            "taskName": "build",
            "isBuildCommand": true,
            "problemMatcher": problemMatcher
        },
        {
            "taskName": "test",
            "isTestCommand": true,
            "problemMatcher": problemMatcher
        },
        {
            "taskName": "run",
            "problemMatcher": problemMatcher
        },
        {
            "taskName": "doc",
            "problemMatcher": problemMatcher
        },
        {
            "taskName": "fmt",
            "problemMatcher": problemMatcher
        }
    ]
};

export function create() {
    let dir = path.join(vscode.workspace.rootPath, ".vscode");
    fs.mkdir(dir, (err) => {
        if (err && err.code !== "EEXIST") {
            console.log(err);
            vscode.window.showErrorMessage(err.message);
        } else {
            let file = path.join(dir, "tasks.json");
            let data = JSON.stringify(tasks, undefined, 4);
            let options = { flag: "w" };
            fs.writeFile(file, data, options, (err) => {
                if (err) {
                    console.log(err);
                    vscode.window.showErrorMessage(`${err.code}: ${err.message}`);
                } else {
                    vscode.window.showInformationMessage(`${file} successfully written.`);
                }
            });
        }
    });
}
