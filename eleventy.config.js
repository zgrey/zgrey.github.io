import yaml from "js-yaml";

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/.nojekyll");

  // The EVIE dashboard worked example is written but NOT PUBLISHED: the `evie`
  // repository it documents is still private and under NIST internal review,
  // so the page must not be served or indexed yet. Ignoring it here keeps it
  // out of _site entirely while leaving the build green -- `permalink: false`
  // in its front matter also excludes it, but makes Eleventy 3.1.6 exit
  // non-zero ("Having trouble writing to false"), which fails CI.
  //
  // TO PUBLISH: delete this one line. See src/evie/dashboard/index.njk for the
  // other two steps (drop `noindex`, set REPO_URL).
  eleventyConfig.ignores.add("src/evie/dashboard/index.njk");

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
