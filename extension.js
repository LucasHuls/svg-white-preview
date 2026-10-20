const vscode = require('vscode');
const path = require('path');

const VIEW_TYPE = 'svgWhitePreview.editor';
const BACKGROUNDS = ['white', 'dark', 'checkerboard'];

const panels = new Set();

function getBackground() {
    return vscode.workspace.getConfiguration('svgWhitePreview').get('background', 'white');
}

function broadcast(message) {
    for (const panel of panels) {
        panel.webview.postMessage(message);
    }
}

class SvgPreviewProvider {
    constructor(context) {
        this.context = context;
    }

    openCustomDocument(uri) {
        return { uri, dispose() {} };
    }

    async resolveCustomEditor(document, panel) {
        const uri = document.uri;
        panel.webview.options = { enableScripts: true };
        panel.webview.html = this.getHtml(panel.webview, await this.src(uri));
        panels.add(panel);

        let watcher;
        if (uri.scheme === 'file') {
            watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(path.dirname(uri.fsPath)), path.basename(uri.fsPath))
            );
            const reload = async () => panel.webview.postMessage({ type: 'reload', src: await this.src(uri) });
            watcher.onDidChange(reload);
            watcher.onDidCreate(reload);
        }

        panel.onDidDispose(() => {
            panels.delete(panel);
            if (watcher) watcher.dispose();
        });
    }

    async src(uri) {
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            return 'data:image/svg+xml;base64,' + Buffer.from(bytes).toString('base64');
        } catch (e) {
            return '';
        }
    }

    getHtml(webview, src) {
        const nonce = String(Math.random()).slice(2);
        const background = getBackground();
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    body { display: flex; align-items: center; justify-content: center; }
    body.bg-white { background: #ffffff; }
    body.bg-dark { background: #1e1e1e; }
    body.bg-checkerboard {
        background-color: #ffffff;
        background-image: conic-gradient(#d0d0d0 25%, transparent 25% 50%, #d0d0d0 50% 75%, transparent 75%);
        background-size: 16px 16px;
    }
    #scroll { width: 100%; height: 100%; overflow: auto; display: flex; }
    #scroll.fit { align-items: center; justify-content: center; }
    #scroll.fit img { max-width: calc(100% - 32px); max-height: calc(100% - 32px); width: auto; height: auto; }
    #scroll.actual img { margin: auto; padding: 16px; }
    img { display: block; object-fit: contain; }
    #error { font-family: sans-serif; color: #c00; padding: 16px; }
</style>
</head>
<body class="bg-${background}">
<div id="scroll" class="fit"><img id="svg" src="${src}" alt="SVG preview"></div>
<script nonce="${nonce}">
    const img = document.getElementById('svg');
    const scroll = document.getElementById('scroll');
    img.addEventListener('error', () => {
        scroll.innerHTML = '<div id="error">Could not render this file as an image.</div>';
    });
    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.type === 'background') {
            document.body.className = 'bg-' + msg.value;
        } else if (msg.type === 'reload') {
            img.src = msg.src;
        } else if (msg.type === 'zoom') {
            scroll.className = scroll.className === 'fit' ? 'actual' : 'fit';
        }
    });
</script>
</body>
</html>`;
    }
}

function activate(context) {
    const provider = new SvgPreviewProvider(context);

    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: true,
        }),
        vscode.commands.registerCommand('svgWhitePreview.toggleBackground', async () => {
            const current = getBackground();
            const next = BACKGROUNDS[(BACKGROUNDS.indexOf(current) + 1) % BACKGROUNDS.length];
            await vscode.workspace.getConfiguration('svgWhitePreview').update('background', next, vscode.ConfigurationTarget.Global);
        }),
        vscode.commands.registerCommand('svgWhitePreview.toggleZoom', () => {
            broadcast({ type: 'zoom' });
        }),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('svgWhitePreview.background')) {
                broadcast({ type: 'background', value: getBackground() });
            }
        })
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
