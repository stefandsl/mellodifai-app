export function getAttributeSync(path: string, attribute: string): Buffer;
export function setAttributeSync(
  path: string,
  attribute: string,
  value: string | Buffer,
): void;
export function removeAttributeSync(path: string, attribute: string): void;
export function listAttributesSync(path: string): never;
export function getAttribute(path: string, attribute: string): Promise<Buffer>;
export function setAttribute(
  path: string,
  attribute: string,
  value: string | Buffer,
): Promise<void>;
export function removeAttribute(path: string, attribute: string): Promise<void>;
export function listAttributes(path: string): Promise<never>;
