import * as vscode from "vscode";
import * as fs from "fs";

export const RUST_MODE: vscode.DocumentFilter = {
    language: "rust",
    scheme: "file"
};

export function fsExists(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        fs.exists(path, exists => {
            if (exists) {
                resolve(path);
            } else {
                reject(`could not find file "${path}"`);
            }
        });
    });
}

export function fsMkdir(path) {
    return new Promise((resolve, reject) => {
        fs.mkdir(path, (error) => {
            if (error && error.code !== "EEXIST") {
                reject(`could not create dir "${path}"`);
            } else {
                resolve(path);
            }
        });
    });
}

export function fsWriteFile(path: string, data: string, options?): Promise<string> {
    return new Promise((resolve, reject) => {
        fs.writeFile(path, data, options, error => {
            if (error) {
                reject(`could not write file "${path}"`);
            } else {
                resolve(path);
            }
        });
    });
}