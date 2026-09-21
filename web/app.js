// 公共：高亮当前导航 + 通用 fetch 工具
(function () {
  const here = (location.pathname === "/" ? "index.html" : location.pathname.split("/").pop());
  document.querySelectorAll(".topbar nav a").forEach((a) => {
    const href = a.getAttribute("href");
    if (href === here) a.classList.add("active");
  });

  window.api = {
    async get(path) {
      const r = await fetch(path);
      return r.json();
    },
    el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    },
    gradeClass(g) {
      return { A: "grade A", B: "grade B", C: "grade C", D: "grade D" }[g] || "badge";
    },
  };
})();
