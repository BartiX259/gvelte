export function inspect(obj) {
  let proto = Object.getPrototypeOf(obj);
  while (proto) {
    print("--- " + proto.constructor.name + " ---");
    print(Object.getOwnPropertyNames(proto).join(", "));
    proto = Object.getPrototypeOf(proto);
  }
}
