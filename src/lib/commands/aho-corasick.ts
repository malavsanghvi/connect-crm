// Finding many strings in a text at once, in one pass (Aho-Corasick). A community can have thousands of children and each has
// several written forms; running a regular expression per form over every string of every result would be far too slow.
// Pure: no dependencies.

export class AhoCorasick {
  private readonly go: Map<number, number>[] = [new Map()];
  private readonly outs: (number[] | null)[] = [null];
  private fail: Int32Array = new Int32Array(1);
  private dict: Int32Array = new Int32Array(1);
  private built = false;

  /** How many strings were added. */
  size = 0;

  /** Adds a string; `id` comes back from search() for every place it is found. */
  add(pattern: string, id: number): void {
    if (!pattern) return;
    let node = 0;
    for (let i = 0; i < pattern.length; i += 1) {
      const c = pattern.charCodeAt(i);
      let next = this.go[node].get(c);
      if (next === undefined) {
        next = this.go.length;
        this.go.push(new Map());
        this.outs.push(null);
        this.go[node].set(c, next);
      }
      node = next;
    }
    (this.outs[node] ??= []).push(id);
    this.size += 1;
    this.built = false;
  }

  private build(): void {
    const n = this.go.length;
    this.fail = new Int32Array(n);
    this.dict = new Int32Array(n);
    const queue: number[] = [];
    for (const child of this.go[0].values()) queue.push(child);
    for (let head = 0; head < queue.length; head += 1) {
      const node = queue[head];
      for (const [c, child] of this.go[node]) {
        let f = this.fail[node];
        while (f !== 0 && !this.go[f].has(c)) f = this.fail[f];
        const target = this.go[f].get(c);
        this.fail[child] = target !== undefined && target !== child ? target : 0;
        const link = this.fail[child];
        this.dict[child] = this.outs[link] ? link : this.dict[link];
        queue.push(child);
      }
    }
    this.built = true;
  }

  /** Calls `found(id, end)` for every added string that ends before index `end` in `text` (so it starts at end - its length). */
  search(text: string, found: (id: number, end: number) => void): void {
    if (this.size === 0) return;
    if (!this.built) this.build();
    let state = 0;
    for (let i = 0; i < text.length; i += 1) {
      const c = text.charCodeAt(i);
      while (state !== 0 && !this.go[state].has(c)) state = this.fail[state];
      state = this.go[state].get(c) ?? 0;
      for (let s = this.outs[state] ? state : this.dict[state]; s !== 0; s = this.dict[s]) {
        for (const id of this.outs[s] as number[]) found(id, i + 1);
      }
    }
  }
}
