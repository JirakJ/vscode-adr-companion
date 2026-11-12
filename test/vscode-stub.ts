/**
 * Minimal stand-in for the `vscode` module so activation can be smoke-tested
 * without an extension host. Unknown members resolve to permissive proxies.
 */
export const registered: string[] = [];

function anything(): any {
  const fn = function () {
    return anything();
  };
  return new Proxy(fn, {
    get: (_t, prop) => {
      if (prop === 'then') return undefined;
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'dispose') return () => undefined;
      return anything();
    },
    apply: () => anything(),
    construct: () => anything(),
  });
}

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  event = (l: (e: T) => void) => {
    this.listeners.push(l);
    return { dispose: () => undefined };
  };
  fire(e: T) {
    for (const l of this.listeners) l(e);
  }
  dispose() {}
}

export class Uri {
  constructor(readonly fsPath: string, readonly scheme = 'file') {}
  static file(p: string) {
    return new Uri(p);
  }
  static parse(p: string) {
    return new Uri(p, p.split(':')[0]);
  }
  toString() {
    return `${this.scheme}://${this.fsPath}`;
  }
}

const config = { get: (_k: string, d: unknown) => d, update: async () => undefined };
const disposable = { dispose: () => undefined };

export const workspace = {
  workspaceFolders: [],
  textDocuments: [],
  isTrusted: true,
  getConfiguration: () => config,
  createFileSystemWatcher: () => ({ onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => undefined }),
  onDidChangeWorkspaceFolders: () => disposable,
  onDidChangeConfiguration: () => disposable,
  onDidSaveTextDocument: () => disposable,
  onDidChangeTextDocument: () => disposable,
  onDidOpenTextDocument: () => disposable,
  onDidCloseTextDocument: () => disposable,
  getWorkspaceFolder: () => undefined,
};

export const commands = {
  registerCommand: (id: string) => {
    registered.push(id);
    return disposable;
  },
  executeCommand: async () => undefined,
};

export const window = {
  createOutputChannel: () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined }),
  createTreeView: () => ({ dispose: () => undefined, description: '' }),
  createStatusBarItem: () => ({ show: () => undefined, hide: () => undefined, dispose: () => undefined }),
  activeTextEditor: undefined,
};

export const languages = {
  createDiagnosticCollection: () => ({ clear: () => undefined, set: () => undefined, delete: () => undefined, dispose: () => undefined }),
  registerHoverProvider: () => disposable,
  registerDocumentLinkProvider: () => disposable,
  registerCompletionItemProvider: () => disposable,
};

export const StatusBarAlignment = { Left: 1, Right: 2 };
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
export const ConfigurationTarget = { Global: 1 };
export const ProgressLocation = { Notification: 15 };
export const ThemeIcon = anything();
export const ThemeColor = anything();
export const RelativePattern = anything();
export default anything();
