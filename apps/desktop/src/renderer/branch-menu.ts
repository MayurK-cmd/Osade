export type BranchMenuEvent =
  | { type: 'toggle' }
  | { type: 'close' }
  | { type: 'select' }
  | { type: 'outside_click' }
  | { type: 'escape' }
  | { type: 'focus_lane_change' };

/** Branch picker stays open only while `open` is true; selection and focus changes dismiss it. */
export function branchMenuReducer(open: boolean, event: BranchMenuEvent): boolean {
  switch (event.type) {
    case 'toggle':
      return !open;
    case 'close':
    case 'select':
    case 'outside_click':
    case 'escape':
    case 'focus_lane_change':
      return false;
    default:
      return open;
  }
}
