// Copies to the clipboard. The email goes on as HTML and as plain text,
// so Outlook keeps the format and plain text apps still get clean text.

function copyWithEvent(html, text) {
  let done = false;
  const onCopy = (event) => {
    event.clipboardData.setData("text/plain", text);
    if (html) event.clipboardData.setData("text/html", html);
    event.preventDefault();
    done = true;
  };
  document.addEventListener("copy", onCopy, { once: true });
  try {
    const ok = document.execCommand("copy");
    return ok && done;
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", onCopy);
  }
}

// Last fallback: select real formatted content on the page and copy it.
function copyBySelection(html, text) {
  const box = document.createElement(html ? "div" : "textarea");
  box.className = "copy-buffer";
  if (html) {
    box.contentEditable = "true";
    box.innerHTML = html;
  } else {
    box.value = text;
  }
  document.body.appendChild(box);
  try {
    if (html) {
      const range = document.createRange();
      range.selectNodeContents(box);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      box.select();
    }
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    window.getSelection().removeAllRanges();
    box.remove();
  }
}

export async function copyRich(html, text) {
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch {
    // Fall through to the older ways below.
  }
  return copyWithEvent(html, text) || copyBySelection(html, text);
}

export async function copyPlain(text) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through.
  }
  return copyWithEvent("", text) || copyBySelection("", text);
}
