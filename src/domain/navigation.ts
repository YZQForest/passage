import type { Position } from "./models";
export class NavigationStack {
  private backItems: Position[] = [];
  private forwardItems: Position[] = [];
  push(position: Position) {
    this.backItems.push({ ...position });
    this.forwardItems = [];
  }
  back(current: Position) {
    const target = this.backItems.pop();
    if (target) this.forwardItems.push({ ...current });
    return target;
  }
  forward(current: Position) {
    const target = this.forwardItems.pop();
    if (target) this.backItems.push({ ...current });
    return target;
  }
  get canBack() {
    return this.backItems.length > 0;
  }
  get canForward() {
    return this.forwardItems.length > 0;
  }
}
