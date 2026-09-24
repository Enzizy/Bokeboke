/** What a Rapier rigid body belongs to, looked up by body handle after a hit query. */
export type EntityRef =
  | { kind: 'player'; id: number }
  | { kind: 'crate'; id: number }
  | { kind: 'pickup'; id: number };

export class EntityRegistry {
  private readonly byBody = new Map<number, EntityRef>();

  register(bodyHandle: number, ref: EntityRef): void {
    this.byBody.set(bodyHandle, ref);
  }

  unregister(bodyHandle: number): void {
    this.byBody.delete(bodyHandle);
  }

  lookup(bodyHandle: number): EntityRef | undefined {
    return this.byBody.get(bodyHandle);
  }
}
