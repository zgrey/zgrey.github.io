import yaml from "js-yaml";

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/.nojekyll");

  // KaTeX is self-hosted from node_modules rather than loaded from a CDN, so
  // the version browsers run is the one npm audit and Dependabot can see.
  // katex.min.css resolves its fonts relative to itself, hence fonts/ beside it.
  eleventyConfig.addPassthroughCopy({
    "node_modules/katex/dist/katex.min.css": "assets/vendor/katex/katex.min.css",
    "node_modules/katex/dist/katex.min.js": "assets/vendor/katex/katex.min.js",
    "node_modules/katex/dist/contrib/auto-render.min.js": "assets/vendor/katex/contrib/auto-render.min.js",
    "node_modules/katex/dist/fonts": "assets/vendor/katex/fonts",
  });

  // Parse YAML front matter with js-yaml 4.x (load/dump). gray-matter@4.0.3's
  // default engine calls the removed safeLoad/safeDump, so once js-yaml is
  // overridden to >=4.2.0 (CVE-2026-53550 patch) we must supply this engine.
  eleventyConfig.setFrontMatterParsingOptions({
    engines: {
      yaml: {
        parse: (s) => yaml.load(s),
        stringify: (o) => yaml.dump(o),
      },
    },
  });


  eleventyConfig.addFilter("readableDate", (dateObj) => {
    const d = new Date(dateObj);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  });

  eleventyConfig.addFilter("isoDate", (dateObj) => {
    return new Date(dateObj).toISOString().split("T")[0];
  });

  eleventyConfig.addFilter("year", () => {
    return new Date().getFullYear();
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
    templateFormats: ["njk", "md"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
