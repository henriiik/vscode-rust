import * as vscode from "vscode";
import * as path from "path";
import {fsMkdir, fsWriteFile} from "./utils";

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
    fsMkdir(dir)
        .then(() => {
            let file = path.join(dir, "tasks.json");
            let data = JSON.stringify(tasks, undefined, 4);
            let options = { flag: "w" };
            return fsWriteFile(file, data, options);
        })
        .then(path => {
            vscode.window.showInformationMessage(`${path} successfully written.`);
        })
        .catch(error => {
            vscode.window.showErrorMessage(`could not create tasks.json: ${error}`);
        });
}
