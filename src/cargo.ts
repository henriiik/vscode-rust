import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";

let errorRegex = /^(.*):(\d+):(\d+):\s(\d+):(\d+)\s(\w+):\s(.*)$/;

let severity = {
	error: vscode.DiagnosticSeverity.Error,
	help: vscode.DiagnosticSeverity.Hint
};

function makeDiagnostic(data: RegExpExecArray): vscode.Diagnostic {
	let start = new vscode.Position(
		Number(data[2]) - 1,
		Number(data[3]) - 1
	);
	let end = new vscode.Position(
		Number(data[4]) - 1,
		Number(data[5]) - 1
	);

	let range = new vscode.Range(start, end);

	return new vscode.Diagnostic(range, data[7], severity[data[6]]);
}

function parseOutput(output: string) {
	let lines = output.split("\n");
	let some: vscode.Diagnostic[] = [];
	let diagnostics = vscode.languages.createDiagnosticCollection("rust");
	let errors = {};

	for (let line of lines) {
		let match = errorRegex.exec(line);
		if (match) {
			errors[match[1]] = errors[match[1]] || [];
			errors[match[1]].push(makeDiagnostic(match));
		}
	}

	for (let file in errors) {
		diagnostics.set(
			vscode.Uri.file(path.join(vscode.workspace.rootPath, file)),
			errors[file]
		);
	}
}

export function build() {
	let child = cp.spawn("cargo", ["build"], {
		cwd: vscode.workspace.rootPath
	});

	let output = "";
	let channel = vscode.window.createOutputChannel("cargo");
	let column = vscode.ViewColumn.Three;

	channel.show(column);

	child.stdout.on("data", (buffer: Buffer) => {
		let out = buffer.toString();
		channel.append(out);
		output += out;
	});

	child.stderr.on("data", (buffer: Buffer) => {
		let out = buffer.toString();
		channel.append(out);
		output += out;
	});

	child.on("exit", wat => {
		parseOutput(output);
	});
}
