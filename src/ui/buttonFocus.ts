export function keepButtonsUnfocused(root: ParentNode = document): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>("button")) {
    button.tabIndex = -1;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("mouseup", () => button.blur());
    button.addEventListener("click", () => button.blur());
  }
}
