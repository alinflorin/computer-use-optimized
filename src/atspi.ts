import dbus from "dbus-next";

const { Message, Variant } = dbus;
type Bus = dbus.MessageBus;

const A11Y = "org.a11y.atspi";
export const ACCESSIBLE = `${A11Y}.Accessible`;

/** A reference to an accessible object: unique bus name + object path. */
export interface Ref {
  svc: string;
  path: string;
}

let busPromise: Promise<Bus> | undefined;

/** Connect to the dedicated accessibility bus (not the session bus). */
export function getBus(): Promise<Bus> {
  busPromise ??= (async () => {
    const session = dbus.sessionBus();
    const reply = await session.call(
      new Message({
        destination: "org.a11y.Bus",
        path: "/org/a11y/bus",
        interface: "org.a11y.Bus",
        member: "GetAddress",
      }),
    );
    session.disconnect();
    return dbus.sessionBus({ busAddress: reply?.body[0] as string });
  })();
  return busPromise;
}

export async function call(
  ref: Ref,
  iface: string,
  member: string,
  signature?: string,
  body?: unknown[],
): Promise<unknown[]> {
  const bus = await getBus();
  const reply = await bus.call(
    new Message({ destination: ref.svc, path: ref.path, interface: iface, member, signature, body }),
  );
  return reply?.body ?? [];
}

export async function getProp(ref: Ref, iface: string, prop: string): Promise<unknown> {
  const [v] = (await call(ref, "org.freedesktop.DBus.Properties", "Get", "ss", [iface, prop])) as [
    InstanceType<typeof Variant>,
  ];
  return v.value;
}

export const REGISTRY_ROOT: Ref = {
  svc: "org.a11y.atspi.Registry",
  path: "/org/a11y/atspi/accessible/root",
};

export async function getChildren(ref: Ref): Promise<Ref[]> {
  const [kids] = (await call(ref, ACCESSIBLE, "GetChildren")) as [[string, string][]];
  return kids.map(([svc, path]) => ({ svc, path }));
}

export interface NodeInfo {
  ref: Ref;
  role: string;
  name: string;
  children: NodeInfo[];
}

/** Walk the tree to `maxDepth`, fetching each node's details in parallel. */
export async function walk(ref: Ref, maxDepth: number): Promise<NodeInfo> {
  const [role, name, kids] = await Promise.all([
    call(ref, ACCESSIBLE, "GetRoleName").then((b) => String(b[0])),
    getProp(ref, ACCESSIBLE, "Name").then(String),
    maxDepth > 0 ? getChildren(ref) : Promise.resolve([]),
  ]).catch(() => ["?", "", [] as Ref[]] as const);
  const children = await Promise.all(
    (kids as Ref[]).map((k) => walk(k, maxDepth - 1).catch(() => null)),
  );
  return { ref, role: role as string, name: name as string, children: children.filter((c) => c !== null) };
}

export function format(node: NodeInfo, depth = 0): string {
  const label = node.name ? ` "${node.name}"` : "";
  const line = `${"  ".repeat(depth)}[${node.role}]${label}`;
  return [line, ...node.children.map((c) => format(c, depth + 1))].join("\n");
}

// ---- Interaction -----------------------------------------------------------

export async function doAction(ref: Ref, index = 0): Promise<boolean> {
  const [ok] = await call(ref, `${A11Y}.Action`, "DoAction", "i", [index]);
  return Boolean(ok);
}

export async function actionNames(ref: Ref): Promise<string[]> {
  const n = Number(await getProp(ref, `${A11Y}.Action`, "NActions").catch(() => 0));
  const names = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      call(ref, `${A11Y}.Action`, "GetName", "i", [i]).then((b) => String(b[0])),
    ),
  );
  return names;
}

export async function setText(ref: Ref, text: string): Promise<boolean> {
  const [ok] = await call(ref, `${A11Y}.EditableText`, "SetTextContents", "s", [text]);
  return Boolean(ok);
}

export async function grabFocus(ref: Ref): Promise<boolean> {
  const [ok] = await call(ref, `${A11Y}.Component`, "GrabFocus");
  return Boolean(ok);
}

/** Screen-coordinate extents: [x, y, width, height]. */
export async function getExtents(ref: Ref): Promise<[number, number, number, number]> {
  const [r] = (await call(ref, `${A11Y}.Component`, "GetExtents", "u", [0])) as [number[]];
  return r as [number, number, number, number];
}
