import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {isDeepStrictEqual as equal} from 'node:util';
import {inflateSync} from 'node:zlib';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const includes = (value, item) => value.includes(item);
const zip = (a, b) => a.map((value, index) => [value, b[index]]);

class FixtureDriver {
  constructor(page) {
    this.page = page;
    this.pointer = {x: 0, y: 0};
  }

  navigate({url}) {
    return this.page.goto(url);
  }

  async screenshot() {
    return (await this.page.screenshot({fullPage: false})).toString('base64');
  }

  evaluate(script) {
    return this.page.evaluate(source => new Function(source)(), script);
  }

  async wait(script, {timeout = 15} = {}) {
    const deadline = Date.now() + timeout * 1000;
    while (Date.now() < deadline) {
      const result = await this.evaluate(script);
      if (result) return result;
      await sleep(100);
    }
    throw new Error('Timed out: ' + script.slice(0, 160));
  }

  async click(expression) {
    const point = await this.evaluate('const e=' + expression + '; if(!e) throw Error("Missing test control");const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};');
    await this.page.mouse.click(point.x, point.y);
    this.pointer = point;
  }

  async actions({actions}) {
    for (const source of actions) {
      for (const action of source.actions) {
        if (action.type === 'pointerMove') {
          const start = this.pointer;
          const steps = Math.max(1, Math.ceil((action.duration || 0) / 16));
          for (let step = 1; step <= steps; step++) {
            const x = start.x + (action.x - start.x) * step / steps;
            const y = start.y + (action.y - start.y) * step / steps;
            await this.page.mouse.move(x, y);
            if (action.duration) await sleep(action.duration / steps);
          }
          this.pointer = {x: action.x, y: action.y};
        } else if (action.type === 'pointerDown') {
          await this.page.mouse.down({button: ['left', 'middle', 'right'][action.button]});
        } else if (action.type === 'pointerUp') {
          await this.page.mouse.up({button: ['left', 'middle', 'right'][action.button]});
        } else if (action.type === 'keyDown') {
          await this.page.keyboard.down(action.value);
        } else if (action.type === 'keyUp') {
          await this.page.keyboard.up(action.value);
        } else if (action.type === 'pause') {
          await sleep(action.duration);
        } else {
          throw new Error('Unsupported fixture action: ' + action.type);
        }
      }
    }
  }
}

function pixel(image, x, y) {
  const data = Buffer.from(image, "base64");
  let index = 8, width, height, depth, color;
  const compressed = [];
  while (index < data.length) {
    const length = data.readUInt32BE(index);
    const kind = data.subarray(index + 4, index + 8).toString();
    const chunk = data.subarray(index + 8, index + 8 + length);
    index += length + 12;
    if (kind === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      depth = chunk[8];
      color = chunk[9];
    } else if (kind === "IDAT") compressed.push(chunk);
  }
  assert.ok(depth === 8 && [2, 6].includes(color), JSON.stringify({ depth, color }));
  const channels = color === 6 ? 4 : 3, stride = width * channels;
  const raw = inflateSync(Buffer.concat(compressed));
  let previous = new Uint8Array(stride);
  for (let rowIndex = 0; rowIndex <= y; rowIndex++) {
    const filter = raw[rowIndex * (stride + 1)];
    const row = Uint8Array.from(raw.subarray(rowIndex * (stride + 1) + 1, (rowIndex + 1) * (stride + 1)));
    for (let column = 0; column < stride; column++) {
      const left = column >= channels ? row[column - channels] : 0;
      const above = previous[column], corner = column >= channels ? previous[column - channels] : 0;
      const estimate = left + above - corner;
      const distances = [Math.abs(estimate - left), Math.abs(estimate - above), Math.abs(estimate - corner)];
      const predictors = [0, left, above, Math.floor((left + above) / 2), [left, above, corner][distances.indexOf(Math.min(...distances))]];
      row[column] = row[column] + predictors[filter] & 255;
    }
    previous = row;
  }
  return [Array.from(previous.subarray(x * channels, x * channels + 3)), width, height];
}
async function exercise_options(driver, origin, scenario) {
  let expected, saved, url;
  url = origin + "/tests/fixtures/options.html?scenario=" + scenario;
  await driver.navigate({ "url": url });
  await driver.wait('return document.querySelector(".domain-row input")&&!document.querySelector(".domain-row input").disabled;');
  for (const host of ["https://alpha.example", "https://beta.example"]) {
    await driver.click('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Add address")');
    await driver.evaluate('const e=Array.from(document.querySelectorAll(".domain-row input")).at(-1);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(host) + ');e.dispatchEvent(new Event("input",{bubbles:true}));return true;');
  }
  if (equal(scenario, "options-clouds-only")) {
    await driver.click('document.querySelectorAll(".domain-folder-toggle")[1]');
  }
  await driver.click('document.querySelector("button[type=submit]")');
  await driver.wait('return !!document.querySelector("[role=status]")&&!document.querySelector("button[type=submit]").disabled;');
  expected = ["https://console.yandex.cloud", "https://alpha.example", "https://beta.example"];
  assert.ok(equal(await driver.evaluate("return fixture.requests;"), [{ "origins": expected.map((host) => host + "/*") }]));
  if (equal(scenario, "options-denied")) {
    assert.ok(equal(await driver.evaluate("return fixture.writes;"), []));
    assert.ok(equal(await driver.evaluate('return document.querySelector("[role=status]").textContent;'), "Access was not granted. Settings have not changed"));
    return { "scenario": scenario, "denied": "no settings written" };
  }
  saved = await driver.evaluate("return fixture.memory;");
  assert.ok(equal(saved["domainHosts"], expected), JSON.stringify(saved));
  assert.ok(equal(saved["cloudOnlyHosts"], equal(scenario, "options-clouds-only") ? ["https://alpha.example"] : []), JSON.stringify(saved));
  await driver.navigate({ "url": url });
  await driver.wait('return document.querySelectorAll(".domain-row input").length===3&&!document.querySelector(".domain-row input").disabled;');
  assert.ok(equal(await driver.evaluate('return Array.from(document.querySelectorAll(".domain-row input")).map(e=>e.value);'), expected));
  assert.ok(equal(await driver.evaluate('return Array.from(document.querySelectorAll(".domain-folder-toggle")).map(e=>e.classList.contains("g-button_view_outlined-info"));'), [false, equal(scenario, "options-clouds-only"), false]));
  return { "scenario": scenario, "saved": "two new addresses persisted across reload", "cloudsOnly": equal(scenario, "options-clouds-only") };
}
async function exercise(driver, origin, scenario) {
  let actual, alignment, alpha, alpha_prefs, before, beta, beta_prefs, clicks, cloud, colors, compact, default_icon, delay, disclosure, during, expected, geometry, grid, href, icon, icons, ids, initial, initial_label, layout, modern, point, points, prefix, prefs, preset, ready, rocket, root, screenshot, selected, spacing, text, tooltip, tree_style, value, visibility, widths;
  if (scenario.startsWith("options-")) {
    return await exercise_options(driver, origin, scenario);
  }
  await driver.navigate({ "url": origin + "/tests/fixtures/native-tree.html?scenario=" + scenario });
  if (includes(["empty-cloud", "becomes-empty"], scenario)) {
    await driver.wait('const r=document.querySelector("[data-ycp-host]")?.shadowRoot;return !!r?.querySelector(".ycp-cloud")&&!r.querySelector(".ycp-status");', { timeout: 25 });
    if (equal(scenario, "becomes-empty")) {
      assert.ok(await driver.evaluate('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder");'));
      await driver.evaluate("fixture.removeAlphaFolder();return true;");
      await driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).find(b=>b.getAttribute("aria-label")==="Refresh clouds")');
    }
    await driver.wait('const r=document.querySelector("[data-ycp-host]").shadowRoot;return r.querySelector(".ycp-cloud>button").disabled&&!r.querySelector(".ycp-status");', { timeout: 25 });
    assert.ok(equal(await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-cloud>button").getAttribute("aria-expanded");'), "false"));
    assert.ok(!await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.textContent.includes("No folders");'));
    await driver.wait('return !fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"].expandedClouds.includes("cloud-alpha");');
    await driver.evaluate('history.pushState(null,"","/clouds/cloud-alpha");return true;');
    await driver.evaluate("browser.storage.local.set({compactDensity:true});return true;");
    assert.ok(equal(await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-cloud>button").getAttribute("aria-expanded");'), "false"));
    if (equal(scenario, "becomes-empty")) {
      await driver.evaluate("fixture.addAlphaFolder();return true;");
      await driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).find(b=>b.getAttribute("aria-label")==="Refresh clouds")');
      await driver.wait('const r=document.querySelector("[data-ycp-host]").shadowRoot;return !r.querySelector(".ycp-cloud>button").disabled&&!r.querySelector(".ycp-status");', { timeout: 25 });
      await driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-cloud>button")');
      await driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder");');
    }
    return { "scenario": scenario, "emptyCloud": "collapsed after confirmed load", "navigation": "does not reopen empty cloud", "savedState": "collapsed", ...equal(scenario, "becomes-empty") ? { "newFolders": "expansion enabled after refresh" } : {} };
  }
  if (equal(scenario, "folder-order")) {
    expected = ["folder-deploy", "folder-api-2", "folder-api-10", "folder-fallback", "folder-dup-a", "folder-dup-b", "folder-alpha"];
    ids = 'Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll("[data-cloud-id=cloud-alpha] .ycp-folder a")).map(e=>e.getAttribute("href").split("/").pop())';
    await driver.wait("return (" + ids + ").length===7;");
    assert.ok(equal(await driver.evaluate("return " + ids + ";"), expected));
    await driver.wait('return !document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-status");', { timeout: 25 });
    await driver.evaluate('fixture.orderChanged=false;const r=document.querySelector("[data-ycp-host]").shadowRoot;new MutationObserver(()=>{const ids=' + ids + ';if(ids.length===7&&ids.join(",")!==' + JSON.stringify(expected.join(",")) + ")fixture.orderChanged=true}).observe(r,{childList:true,subtree:true});fixture.reverseAlpha();return true;");
    await driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).find(b=>b.getAttribute("aria-label")==="Refresh clouds")');
    await driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-status");');
    await driver.wait('return !document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-status");', { timeout: 25 });
    assert.ok(!await driver.evaluate("return fixture.orderChanged;"));
    assert.ok(equal(await driver.evaluate("return " + ids + ";"), expected));
    await driver.evaluate('const key="yc-power:"+location.origin+":organization:id:org-alpha",prefs=structuredClone(fixture.memory[key]);prefs.custom["folder:folder-alpha"].label="AAA";browser.storage.local.set({[key]:prefs});return true;');
    await driver.wait("return (" + ids + ')[0]==="folder-alpha";');
    return { "scenario": scenario, "order": "display labels with numeric sorting", "refresh": "stable despite reversed native arrival", "rename": "reorders immediately", "ties": "stable by ID" };
  }
  if (scenario.startsWith("retry") || scenario.startsWith("startup-")) {
    if (equal(scenario, "startup-container-late5s")) {
      await driver.wait("return performance.now()-fixture.retryStartedAt>5100;", { timeout: 8 });
      assert.ok(!await driver.evaluate('return !!document.querySelector("[data-ycp-host]");'));
    }
    await driver.wait('const r=document.querySelector("[data-ycp-host]")?.shadowRoot;return !!r?.querySelector(".ycp-cloud");');
    if (scenario.startsWith("retry") || equal(scenario, "startup-poll-fallback")) {
      assert.ok(await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder a")?.getAttribute("href").includes("folder-old");'));
      assert.ok(!await driver.evaluate("return fixture.scanStarts.length>0||fixture.errors.length>0;"));
    }
    if (equal(scenario, "retry-permanent")) {
      await driver.wait("return performance.now()-fixture.retryStartedAt>4500;", { timeout: 7 });
      assert.ok(!await driver.evaluate("return fixture.errors.length>0;"));
      await driver.wait("return fixture.errors.length===1;", { timeout: 4 });
      assert.ok(await driver.evaluate("return fixture.errors[0]-fixture.retryStartedAt;") >= 4900);
      assert.ok(!await driver.evaluate("return fixture.scanStarts.length>0;"));
      assert.ok(await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder a")?.getAttribute("href").includes("folder-old");'));
      await driver.evaluate("browser.storage.local.set({domainHosts:[]});return true;");
      await driver.wait('return !document.querySelector("[data-ycp-host]");');
      await driver.evaluate('document.querySelector(".cloud-tree-list-container > div:last-child").classList.add("cloud-tree-list");fixture.disabledAt=performance.now();return true;');
      await driver.wait("return performance.now()-fixture.disabledAt>1100;");
      assert.ok(!await driver.evaluate('return !!document.querySelector("[data-ycp-host]");'));
      await driver.evaluate('sessionStorage.removeItem("fixture:retry-permanent");return true;');
      await driver.navigate({ "url": origin + "/tests/fixtures/native-tree.html?scenario=retry-permanent" });
      await driver.wait('return !!document.querySelector("[data-ycp-host]");');
      await driver.evaluate("browser.storage.local.set({domainHosts:[]});fixture.disabledAt=performance.now();return true;");
      await driver.wait('return !document.querySelector("[data-ycp-host]");');
      await driver.wait("return performance.now()-fixture.disabledAt>5200;", { timeout: 7 });
      assert.ok(!await driver.evaluate('return fixture.errors.length>0||fixture.scanStarts.length>0||!!document.querySelector("[data-ycp-host]");'));
      return { "scenario": scenario, "deadline": "one error after 5 seconds", "cache": "retained", "cleanup": "pending deadline and late readiness do not remount" };
    }
    if (includes(["startup-late-attribute", "startup-late-empty-text"], scenario)) {
      await driver.wait("return fixture.errors.length===1;", { timeout: 7 });
      assert.ok(await driver.evaluate("return fixture.errors[0]-fixture.retryStartedAt;") >= 4900);
      assert.ok(await driver.evaluate("return !fixture.readyAt||fixture.errors[0]<fixture.readyAt;"));
    }
    if (equal(scenario, "retry-defers")) {
      await driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-all-row button")');
      expected = await driver.evaluate('const list=document.querySelector(".cloud-tree-list-container > div:last-child");list.scrollTop=250;return list.scrollTop;');
      await driver.wait("return !!fixture.readyAt&&performance.now()-fixture.readyAt>400;");
      assert.ok(!await driver.evaluate("return fixture.scanStarts.length>0;"));
      assert.ok(equal(await driver.evaluate('return document.querySelector(".cloud-tree-list").scrollTop;'), expected));
      await driver.evaluate("fixture.resumedAt=performance.now();return true;");
      await driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-all-row button")');
    }
    await driver.wait("return fixture.scanStarts.length>0;", { timeout: 8 });
    delay = await driver.evaluate("return fixture.scanStarts[0]-(fixture.resumedAt||fixture.readyAt);");
    assert.ok(0 <= delay && delay < 300, JSON.stringify([scenario, delay]));
    if (equal(scenario, "startup-late-empty-text")) {
      await driver.wait('const r=document.querySelector("[data-ycp-host]").shadowRoot;return !r.querySelector(".ycp-cloud")&&!r.querySelector(".ycp-status");', { timeout: 25 });
      await driver.wait('return fixture.memory["yc-power:"+location.origin+":catalog"]?.length===0;');
      assert.ok(await driver.evaluate("return fixture.scanStarts.length===1&&fixture.errors.length===1;"));
      return { "scenario": scenario, "recovery": "text mutation after deadline clears cached clouds", "scans": "once within 300 ms of readiness" };
    }
    await driver.wait('const r=document.querySelector("[data-ycp-host]").shadowRoot;return Array.from(r.querySelectorAll(".ycp-folder a")).some(e=>e.getAttribute("href").includes("folder-alpha"))&&!Array.from(r.querySelectorAll(".ycp-folder a")).some(e=>e.getAttribute("href").includes("folder-old"))&&!r.querySelector(".ycp-status");', { timeout: 25 });
    assert.ok(equal(await driver.evaluate("return fixture.scanStarts.length;"), 1));
    assert.ok(equal(await driver.evaluate("return fixture.errors.length;"), equal(scenario, "startup-late-attribute") ? 1 : 0));
    if (equal(scenario, "startup-tree-replaced")) {
      await driver.evaluate("fixture.replaceTree();return true;");
      await driver.wait("return fixture.scanStarts.length===2;");
      assert.ok(await driver.evaluate("return fixture.scanStarts[1]-fixture.readyAt;") < 300);
      await driver.wait('const r=document.querySelector("[data-ycp-host]")?.shadowRoot;return !!r?.querySelector(".ycp-folder")&&!r.querySelector(".ycp-status");', { timeout: 25 });
      assert.ok(equal(await driver.evaluate('return document.querySelectorAll("[data-ycp-host]").length;'), 1));
    }
    if (equal(scenario, "startup-poll-fallback")) {
      assert.ok(await driver.evaluate("return fixture.suppressAppObservers;"));
      await driver.evaluate("fixture.suppressAppObservers=false;return true;");
    }
    return { "scenario": scenario, "readiness": "scan starts within 300 ms of ready tree", "scans": "once per ready tree", "foreground": "respected" };
  }
  if (equal(scenario, "delayed-controls")) {
    await driver.wait("return fixture.expansionClicks===1;", { timeout: 25 });
    await driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-all-row button")');
    visibility = await driver.evaluate('const t=document.querySelector(".cloud-tree-list-container"),r=document.querySelector("[data-ycp-host]").shadowRoot;return {expanded:r.querySelector(".ycp-all-row button").getAttribute("aria-expanded"),inert:t.hasAttribute("inert"),covered:t.hasAttribute("data-ycp-covered")};');
    assert.ok(equal(visibility, { "expanded": "true", "inert": false, "covered": false }), JSON.stringify(visibility));
    expected = await driver.evaluate('const list=document.querySelector(".cloud-tree-list");list.scrollTop=250;fixture.pauseAt=performance.now();return list.scrollTop;');
    assert.ok(expected > 0);
    await driver.wait("return performance.now()-fixture.pauseAt>1000;");
    assert.ok(equal(await driver.evaluate('return document.querySelector(".cloud-tree-list").scrollTop;'), expected));
    await driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-all-row button")');
    await driver.wait('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-status")?.textContent.includes("Loading");');
    await driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).find(b=>b.getAttribute("aria-label")==="Default sidebar")');
    await driver.wait('return !!document.querySelector(".ycp-native-return-slot")?.shadowRoot?.querySelector("button");');
    assert.ok(!await driver.evaluate('return document.querySelector(".cloud-tree-list-container").hasAttribute("inert");'));
    expected = await driver.evaluate('const list=document.querySelector(".cloud-tree-list");list.scrollTop=400;fixture.pauseAt=performance.now();return list.scrollTop;');
    await driver.wait("return performance.now()-fixture.pauseAt>1000;");
    assert.ok(equal(await driver.evaluate('return document.querySelector(".cloud-tree-list").scrollTop;'), expected));
    await driver.click('document.querySelector(".ycp-native-return-slot").shadowRoot.querySelector("button")');
    await driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder");', { timeout: 25 });
    return { "scenario": scenario, "allClouds": "opens immediately during load", "defaultSidebar": "interactive during load", "scroll": "not changed by cancelled scans", "resume": "folders load after return" };
  }
  if (equal(scenario, "cloud-order-scroll")) {
    await driver.wait('const r=document.querySelector("[data-ycp-host]")?.shadowRoot;return r?.querySelectorAll(".ycp-folder").length>=26&&!r.querySelector(".ycp-status");', { timeout: 25 });
    points = await driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot;const source=r.querySelector("[data-cloud-id=cloud-alpha] .ycp-link").getBoundingClientRect();const list=r.querySelector(".ycp-mine").getBoundingClientRect();return {source:{x:Math.round(source.x+source.width/2),y:Math.round(source.y+source.height/2)},target:{x:Math.round(list.x+80),y:Math.round(list.bottom-5)}};');
    await driver.actions({ "actions": [{ "type": "pointer", "id": "mouse", "parameters": { "pointerType": "mouse" }, "actions": [{ "type": "pointerMove", "duration": 30, "origin": "viewport", ...points["source"] }, { "type": "pointerDown", "button": 0 }, { "type": "pointerMove", "duration": 600, "origin": "viewport", ...points["target"] }, { "type": "pause", "duration": 1500 }, { "type": "pointerUp", "button": 0 }] }] });
    await driver.wait('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"]?.mine.join(",")==="cloud-beta,cloud-alpha";');
    assert.ok(equal(await driver.evaluate("return location.pathname;"), "/clouds"));
    await driver.evaluate('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-mine").scrollTop=0;return true;');
    await driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector("[data-cloud-id=cloud-beta] .ycp-link")');
    await driver.wait('return location.pathname==="/clouds/cloud-beta";');
    return { "scenario": scenario, "edgeScroll": "reveals next cloud even over source folders", "navigation": "normal click preserved, suppressed during drag" };
  }
  if (equal(scenario, "cloud-order")) {
    await driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelectorAll(".ycp-cloud").length===3;');
    points = await driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot;const source=r.querySelector("[data-cloud-id=cloud-beta] .ycp-link").getBoundingClientRect();const target=r.querySelector("[data-cloud-id=cloud-alpha] .ycp-cloud").getBoundingClientRect();return {source:{x:Math.round(source.x+source.width/2),y:Math.round(source.y+source.height/2)},target:{x:Math.round(target.x+48),y:Math.round(target.y+5)}};');
    await driver.actions({ "actions": [{ "type": "pointer", "id": "mouse", "parameters": { "pointerType": "mouse" }, "actions": [{ "type": "pointerMove", "duration": 30, "origin": "viewport", ...points["source"] }, { "type": "pointerDown", "button": 0 }, { "type": "pointerMove", "duration": 200, "origin": "viewport", "x": points["source"]["x"] + 10, "y": points["source"]["y"] - 5 }, { "type": "pointerMove", "duration": 600, "origin": "viewport", ...points["target"] }, { "type": "pause", "duration": 200 }, { "type": "pointerUp", "button": 0 }] }] });
    try {
      await driver.wait('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"]?.mine.join(",")==="cloud-beta,cloud-alpha,cloud-analytics";');
    } catch (error) {
      throw new Error(JSON.stringify(await driver.evaluate('return {dropMarkers:document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll("[data-ycp-drop]").length,mine:fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"]?.mine};')));
    }
    actual = await driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot;return {order:Array.from(r.querySelectorAll(".ycp-group")).map(e=>e.dataset.cloudId),folder:r.querySelector("[data-cloud-id=cloud-beta] .ycp-folder a")?.getAttribute("href")};');
    assert.ok(equal(actual["order"], ["cloud-beta", "cloud-alpha", "cloud-analytics"]), JSON.stringify(actual));
    assert.ok(includes(actual["folder"], "cloud-beta/folder-beta"), JSON.stringify(actual));
    await driver.navigate({ "url": origin + "/tests/fixtures/native-tree.html?scenario=cloud-order" });
    await driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelectorAll(".ycp-cloud").length===3;');
    assert.ok(equal(await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-group").dataset.cloudId;'), "cloud-beta"));
    await driver.evaluate('document.querySelector("[data-ycp-host]").shadowRoot.querySelector("[data-cloud-id=cloud-beta] .ycp-cloud").focus();return true;');
    await driver.actions({ "actions": [{ "type": "key", "id": "keyboard", "actions": [{ "type": "keyDown", "value": "Alt" }, { "type": "keyDown", "value": "ArrowDown" }, { "type": "keyUp", "value": "ArrowDown" }, { "type": "keyUp", "value": "Alt" }] }] });
    await driver.wait('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"].mine.join(",")==="cloud-alpha,cloud-beta,cloud-analytics";');
    assert.ok(equal(await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.activeElement?.closest("[data-cloud-id]")?.dataset.cloudId;'), "cloud-beta"));
    for (const [arrow, expected2] of [["ArrowUp", "cloud-beta,cloud-alpha,cloud-analytics"], ["ArrowDown", "cloud-alpha,cloud-beta,cloud-analytics"]]) {
      await driver.actions({ "actions": [{ "type": "key", "id": "keyboard", "actions": [{ "type": "keyDown", "value": "Alt" }, { "type": "keyDown", "value": arrow }, { "type": "keyUp", "value": arrow }, { "type": "keyUp", "value": "Alt" }] }] });
      await driver.wait('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"].mine.join(",")===' + JSON.stringify(expected2) + ";");
    }
    await driver.wait('return !document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-status");', { timeout: 25 });
    points = await driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot;const s=r.querySelector("[data-cloud-id=cloud-beta] .ycp-link").getBoundingClientRect(),t=r.querySelector("[data-cloud-id=cloud-alpha] .ycp-cloud").getBoundingClientRect();return {source:{x:Math.round(s.x+s.width/2),y:Math.round(s.y+s.height/2)},target:{x:Math.round(t.x+48),y:Math.round(t.y+5)}};');
    await driver.actions({ "actions": [{ "type": "pointer", "id": "mouse", "parameters": { "pointerType": "mouse" }, "actions": [{ "type": "pointerMove", "duration": 30, "origin": "viewport", ...points["source"] }, { "type": "pointerDown", "button": 0 }, { "type": "pointerMove", "duration": 500, "origin": "viewport", ...points["target"] }] }] });
    await driver.actions({ "actions": [{ "type": "key", "id": "keyboard", "actions": [{ "type": "keyDown", "value": "Escape" }, { "type": "keyUp", "value": "Escape" }] }] });
    await driver.actions({ "actions": [{ "type": "pointer", "id": "mouse", "parameters": { "pointerType": "mouse" }, "actions": [{ "type": "pointerUp", "button": 0 }] }] });
    assert.ok(equal(await driver.evaluate('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"].mine.join(",");'), "cloud-alpha,cloud-beta,cloud-analytics"));
    assert.ok(equal(await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll("[data-ycp-drop],[data-ycp-dragging],[data-reordering]").length;'), 0));
    await driver.actions({ "actions": [{ "type": "pointer", "id": "mouse", "parameters": { "pointerType": "mouse" }, "actions": [{ "type": "pointerMove", "duration": 30, "origin": "viewport", ...points["source"] }, { "type": "pointerDown", "button": 0 }, { "type": "pointerMove", "duration": 500, "origin": "viewport", ...points["target"] }] }] });
    await driver.evaluate('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).find(b=>b.getAttribute("aria-label")==="Default sidebar").focus();return true;');
    await driver.actions({ "actions": [{ "type": "key", "id": "keyboard", "actions": [{ "type": "keyDown", "value": " " }, { "type": "keyUp", "value": " " }] }] });
    await driver.wait('return !!document.querySelector(".ycp-native-return-slot")?.shadowRoot?.querySelector("button");');
    await driver.actions({ "actions": [{ "type": "pointer", "id": "mouse", "parameters": { "pointerType": "mouse" }, "actions": [{ "type": "pointerUp", "button": 0 }] }] });
    await driver.click('document.querySelector(".ycp-native-return-slot").shadowRoot.querySelector("button")');
    await driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-mine");');
    assert.ok(equal(await driver.evaluate('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"].mine.join(",");'), "cloud-alpha,cloud-beta,cloud-analytics"));
    assert.ok(equal(await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll("[data-ycp-drop],[data-ycp-dragging],[data-reordering]").length;'), 0));
    await driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).find(b=>b.getAttribute("aria-label")==="Show all organization clouds in this panel")');
    assert.ok(!await driver.evaluate('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-cloud[data-reorderable]");'));
    return { "scenario": scenario, "mouseDrag": "moves cloud with folders", "reload": "order restored", "keyboard": "Alt+Down works", "allClouds": "native order retained" };
  }
  if (equal(scenario, "folder-icons")) {
    await driver.wait('return !!document.querySelector("[data-ycp-host]")?.shadowRoot.querySelector(".ycp-folder");');
    initial = await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder .ycp-item-icon .g-icon").innerHTML;');
    await driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder .ycp-row-action")');
    await driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder .ycp-row-action")');
    await driver.wait('return !document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-edit");');
    assert.ok(equal(await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder .ycp-row-action").getAttribute("aria-expanded");'), "false"));
    await driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder .ycp-row-action")');
    await driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-edit");');
    assert.ok(equal(await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder .ycp-row-action").getAttribute("aria-expanded");'), "true"));
    grid = await driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot;return Array.from(r.querySelectorAll(".ycp-icons [role=row]")).map(e=>e.querySelectorAll("button").length);');
    assert.ok(equal(grid, [8, 8, 8]), JSON.stringify(grid));
    preset = await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-icons button[value=database] .g-icon").innerHTML;');
    await driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-icons button[value=database]")');
    await driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-edit button[type=submit]")');
    await driver.wait('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"]?.custom["folder:folder-alpha"]?.icon==="database";');
    actual = await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder .ycp-item-icon .g-icon").innerHTML;');
    assert.ok(equal(actual, preset) && !equal(actual, initial));
    await driver.navigate({ "url": origin + "/tests/fixtures/native-tree.html?scenario=folder-icons" });
    await driver.wait('return !!document.querySelector("[data-ycp-host]")?.shadowRoot.querySelector(".ycp-folder");');
    assert.ok(equal(await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder .ycp-item-icon .g-icon").innerHTML;'), preset));
    await driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-cloud button")).find(b=>b.dataset.ycpTooltip==="Label and color")');
    await driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-edit");');
    assert.ok(!await driver.evaluate('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-icons");'));
    return { "scenario": scenario, "presets": "24 in 8x3 grid", "folderIcon": "saved and restored", "cloudIcon": "fixed" };
  }
  if (equal(scenario, "expand-state")) {
    await driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelectorAll(".ycp-cloud").length===2;');
    disclosure = 'Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-cloud")).find(e=>e.querySelector("a").getAttribute("href").endsWith("cloud-beta")).querySelector("button")';
    assert.ok(!await driver.evaluate("return (" + disclosure + ").disabled;"));
    await driver.click(disclosure);
    await driver.actions({ "actions": [{ "type": "pointer", "id": "mouse", "parameters": { "pointerType": "mouse" }, "actions": [{ "type": "pointerMove", "duration": 30, "origin": "viewport", "x": 900, "y": 500 }] }] });
    await driver.wait('const p=fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"];return Array.isArray(p.expandedClouds)&&!p.expandedClouds.includes("cloud-beta");');
    assert.ok(equal(await driver.evaluate("return getComputedStyle((" + disclosure + ').parentElement.querySelector(".ycp-row-action")).opacity;'), "0"));
    await driver.navigate({ "url": origin + "/tests/fixtures/native-tree.html?scenario=expand-state" });
    await driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelectorAll(".ycp-cloud").length===2;');
    assert.ok(equal(await driver.evaluate("return (" + disclosure + ').getAttribute("aria-expanded");'), "false"));
    await driver.evaluate('history.pushState(null,"","/folders/folder-beta/dashboard");return true;');
    await driver.wait("return (" + disclosure + ').getAttribute("aria-expanded")==="true";');
    await driver.click(disclosure);
    await driver.evaluate("browser.storage.local.set({compactDensity:true});return true;");
    assert.ok(equal(await driver.evaluate("return (" + disclosure + ').getAttribute("aria-expanded");'), "false"));
    return { "scenario": scenario, "collapse": "preserved on reload", "navigation": "reveals target once", "mouseFocus": "does not retain actions", "busyDisclosure": "enabled" };
  }
  if (equal(scenario, "empty-cache")) {
    await driver.wait('const r=document.querySelector("[data-ycp-host]")?.shadowRoot;return r?.querySelector(".ycp-header")&&!r.querySelector(".ycp-cloud")&&Array.isArray(fixture.memory["yc-power:"+location.origin+":catalog"])&&fixture.memory["yc-power:"+location.origin+":catalog"].length===0;');
    return { "scenario": scenario, "cache": "cleared after confirmed empty native list" };
  }
  if (equal(scenario, "failed")) {
    await driver.wait('const r=document.querySelector("[data-ycp-host]")?.shadowRoot;return r?.querySelector(".ycp-header")&&r.textContent.includes("Could not read");');
    return { "scenario": scenario, "defaultView": "my clouds retained after scan failure" };
  }
  if (equal(scenario, "multi-regional")) {
    root = 'document.querySelector("[data-ycp-host]").shadowRoot';
    alpha = root + '.querySelector(".ycp-organization-group[data-organization-id=org-alpha]")';
    beta = root + '.querySelector(".ycp-organization-group[data-organization-id=org-beta]")';
    await driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelectorAll(".ycp-cloud").length===2;');
    href = await driver.evaluate("return " + beta + '.querySelector(".ycp-cloud .ycp-link").getAttribute("href");');
    assert.ok(equal(await driver.evaluate("const u=new URL(" + JSON.stringify(href) + ',location.origin);return {path:u.pathname,region:u.searchParams.get("targetRegionId"),service:u.searchParams.get("targetService"),target:u.searchParams.get("targetPath")};'), { "path": "/auth/move", "region": "region-beta", "service": "console", "target": "/cloud/cloud-beta" }));
    assert.ok(!await driver.evaluate("return !!" + beta + '.querySelector(".ycp-cloud > button:first-child[aria-expanded],.ycp-folder");'));
    assert.ok(await driver.evaluate("return !!" + alpha + '.querySelector(".ycp-folder");'));
    await driver.click("Array.from(" + root + '.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Refresh clouds")');
    await driver.wait("return !" + root + '.querySelector(".ycp-status");', { timeout: 25 });
    assert.ok(equal(await driver.evaluate("return fixture.expansionClicks;"), 0));
    await driver.click(root + '.querySelector(".ycp-toggle button")');
    await driver.click('document.querySelector("[data-list-item=\\"cloud.cloud-beta\\"] .ycp-add-native")');
    await driver.wait('return fixture.memory["yc-power:"+location.origin+":organization:id:org-beta"].mine.length===0;');
    await driver.click(root + '.querySelector(".ycp-toggle button")');
    await driver.wait("return !" + root + '.querySelector(".ycp-organization-group[data-organization-id=org-beta]");');
    await driver.click(root + '.querySelector(".ycp-toggle button")');
    await driver.click('document.querySelector("[data-list-item=\\"cloud.cloud-beta\\"] .ycp-add-native")');
    await driver.wait('return fixture.memory["yc-power:"+location.origin+":organization:id:org-beta"].mine.includes("cloud-beta");');
    await driver.click(root + '.querySelector(".ycp-toggle button")');
    await driver.wait("return !!" + beta + '?.querySelector(".ycp-cloud");');
    assert.ok(equal(await driver.evaluate("return " + beta + '.querySelector(".ycp-cloud .ycp-link").getAttribute("href");'), href));
    for (const group of [alpha, beta]) {
      await driver.click(group + '.querySelector(".ycp-organization-row button[aria-expanded]")');
    }
    await driver.wait('const ids=fixture.memory["yc-power:"+location.origin+":layout"].collapsedOrganizations;return ids.includes("org-alpha")&&ids.includes("org-beta");');
    await driver.navigate({ "url": origin + "/tests/fixtures/native-tree.html?scenario=multi-regional" });
    await driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelectorAll(".ycp-organization-row button[aria-expanded=false]").length===2;');
    await driver.click(alpha + '.querySelector(".ycp-organization-row button[aria-expanded]")');
    await driver.wait("return !!" + alpha + '.querySelector(".ycp-cloud");');
    assert.ok(equal(await driver.evaluate("return " + beta + '.querySelector(".ycp-organization-row button").getAttribute("aria-expanded");'), "false"));
    assert.ok(!await driver.evaluate("return !!" + beta + '.querySelector(".ycp-cloud");'));
    assert.ok(equal(await driver.evaluate("return fixture.expansionClicks;"), 0));
    return { "scenario": scenario, "regionalCloud": "native regional href retained without folder expansion", "selection": "native minus and plus work", "collapse": "both groups persist independently across reload" };
  }
  if (equal(scenario, "multi-grouped")) {
    root = 'document.querySelector("[data-ycp-host]").shadowRoot';
    alpha = root + '.querySelector(".ycp-organization-group[data-organization-id=org-alpha]")';
    beta = root + '.querySelector(".ycp-organization-group[data-organization-id=org-beta]")';
    prefix = '"yc-power:"+location.origin';
    alpha_prefs = "fixture.memory[" + prefix + '+":organization:id:org-alpha"]';
    beta_prefs = "fixture.memory[" + prefix + '+":organization:id:org-beta"]';
    layout = "fixture.memory[" + prefix + '+":layout"]';
    await driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelectorAll(".ycp-cloud").length===3;');
    assert.ok(equal(await driver.evaluate("return Array.from(" + root + '.querySelectorAll(".ycp-organization-group")).map(e=>e.dataset.organizationId);'), ["org-alpha", "org-beta"]));
    assert.ok(equal(await driver.evaluate("return Array.from(" + alpha + '.querySelectorAll(".ycp-group")).map(e=>e.dataset.cloudId);'), ["cloud-alpha", "cloud-analytics"]));
    assert.ok(includes(await driver.evaluate("return " + alpha + ".textContent;"), "Alpha selected"));
    assert.ok(includes(await driver.evaluate("return " + beta + ".textContent;"), "Beta custom folder"));
    colors = await driver.evaluate('return ["cloud-alpha","cloud-beta"].map(id=>getComputedStyle(' + root + '.querySelector("[data-cloud-id="+id+"] .ycp-cloud .ycp-item-icon")).color);');
    assert.ok(equal(colors, ["rgb(17, 34, 51)", "rgb(68, 85, 102)"]), JSON.stringify(colors));
    icons = await driver.evaluate('return ["cloud-alpha","cloud-beta"].map(id=>' + root + '.querySelector("[data-cloud-id="+id+"] .ycp-folder .g-icon").innerHTML);');
    assert.ok(!equal(icons[0], icons[1]), JSON.stringify(icons));
    await driver.click(beta + '.querySelector(".ycp-organization-row button[aria-expanded]")');
    await driver.wait("return " + layout + '.collapsedOrganizations.includes("org-beta");');
    await driver.evaluate('const key="yc-power:"+location.origin+":organization:id:org-beta",prefs=structuredClone(fixture.memory[key]);prefs.expandedClouds=[];browser.storage.local.set({[key]:prefs});return true;');
    await driver.navigate({ "url": origin + "/tests/fixtures/native-tree.html?scenario=multi-grouped" });
    await driver.wait("return " + beta + '?.querySelector(".ycp-organization-row button[aria-expanded=false]");');
    assert.ok(!await driver.evaluate("return !!" + beta + '.querySelector(".ycp-cloud");'));
    assert.ok(equal(await driver.evaluate("return " + alpha + '.querySelectorAll(".ycp-cloud").length;'), 2));
    await driver.evaluate('history.pushState(null,"","/clouds/cloud-beta/folder-beta");window.dispatchEvent(new PopStateEvent("popstate"));return true;');
    await driver.wait("return " + beta + '.querySelector(".ycp-organization-row button[aria-expanded=true]")&&' + beta + '.querySelector(".ycp-folder");');
    await driver.click(beta + '.querySelector(".ycp-folder .ycp-row-action")');
    await driver.wait("return !!" + root + '.querySelector(".ycp-edit");');
    await driver.evaluate("const e=" + root + '.querySelector(".ycp-edit input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"Beta edited folder");e.dispatchEvent(new Event("input",{bubbles:true}));return true;');
    await driver.click(root + '.querySelector(".ycp-icons button[value=rocket]")');
    await driver.evaluate(root + '.querySelector(".ycp-edit button[type=submit]").scrollIntoView({block:"nearest"});return true;');
    await driver.click(root + '.querySelector(".ycp-edit button[type=submit]")');
    await driver.wait("return " + beta_prefs + '.custom["folder:folder-beta"]?.label==="Beta edited folder";');
    assert.ok(equal(await driver.evaluate("return " + beta_prefs + '.custom["folder:folder-beta"].icon;'), "rocket"));
    assert.ok(await driver.evaluate("return " + alpha_prefs + '.custom["folder:folder-beta"]||null;') === null);
    assert.ok(equal(await driver.evaluate("return " + alpha_prefs + '.custom["folder:folder-alpha"].label;'), "Alpha custom folder"));
    await driver.evaluate(root + '.querySelector("[data-cloud-id=cloud-alpha] .ycp-cloud").focus();return true;');
    async function move_cloud(arrow) {
      await driver.actions({ "actions": [{ "type": "key", "id": "keyboard", "actions": [{ "type": "keyDown", "value": "Alt" }, { "type": "keyDown", "value": arrow }, { "type": "keyUp", "value": arrow }, { "type": "keyUp", "value": "Alt" }] }] });
    }
    await move_cloud("ArrowDown");
    await driver.wait("return " + alpha_prefs + '.mine.join(",")==="cloud-analytics,cloud-alpha";');
    await move_cloud("ArrowDown");
    assert.ok(equal(await driver.evaluate("return " + alpha_prefs + ".mine;"), ["cloud-analytics", "cloud-alpha"]));
    assert.ok(equal(await driver.evaluate("return " + beta_prefs + ".mine;"), ["cloud-beta"]));
    await driver.click(root + '.querySelector(".ycp-toggle button")');
    await driver.click('document.querySelector("[data-list-item=\\"cloud.cloud-beta\\"] .ycp-add-native")');
    await driver.wait("return " + beta_prefs + ".mine.length===0;");
    await driver.click(root + '.querySelector(".ycp-toggle button")');
    await driver.wait("return !" + root + '.querySelector(".ycp-organization-group[data-organization-id=org-beta]");');
    assert.ok(equal(await driver.evaluate("return " + alpha + '.querySelectorAll(".ycp-cloud").length;'), 2));
    await driver.click(root + '.querySelector(".ycp-toggle button")');
    await driver.click('document.querySelector("[data-list-item=\\"cloud.cloud-beta\\"] .ycp-add-native")');
    await driver.wait("return " + beta_prefs + '.mine.includes("cloud-beta");');
    await driver.click(root + '.querySelector(".ycp-toggle button")');
    await driver.wait("return " + beta + '?.textContent.includes("Beta edited folder");');
    return { "scenario": scenario, "groups": "all saved selections with independent custom data", "collapse": "restored on reload and opened by route", "editing": "saved to owner organization", "reorder": "within organization only", "selection": "removing and adding another organization preserves Alpha" };
  }
  if (equal(scenario, "multi-saved")) {
    await driver.wait('const r=document.querySelector("[data-ycp-host]")?.shadowRoot;return r?.querySelector(".ycp-cloud")&&r.textContent.includes("Beta organization");');
    widths = await driver.evaluate("return [...new Set(fixture.widths)];");
    assert.ok(widths.length > 0 && widths.map((width) => Math.abs(width - 320) < 1).every(Boolean), JSON.stringify(widths));
    return { "scenario": scenario, "savedOrganization": "restored", "initialWidth": "stable" };
  }
  if (equal(scenario, "stale-mount")) {
    root = 'document.querySelector("[data-ycp-host]").shadowRoot';
    await driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelector(".ycp-toggle")&&!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-status");');
    assert.ok(equal(await driver.evaluate("return [fixture.staleHost,fixture.staleSlot,fixture.staleAdd].map(e=>e.isConnected);"), [false, false, false]));
    assert.ok(equal(await driver.evaluate('return [document.querySelectorAll("[data-ycp-host]").length,document.querySelectorAll(".ycp-native-return-slot").length];'), [1, 1]));
    await driver.click(root + '.querySelector(".ycp-toggle button")');
    await driver.click('document.querySelector("[data-list-item=\\"cloud.cloud-alpha\\"] .ycp-add-native")');
    await driver.wait('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"]?.mine.includes("cloud-alpha");');
    await driver.click(root + '.querySelector(".ycp-toggle button")');
    await driver.wait("return !!" + root + '.querySelector("[data-cloud-id=cloud-alpha] .ycp-cloud");');
    await driver.click("Array.from(" + root + '.querySelectorAll(".ycp-header button")).find(b=>b.getAttribute("aria-label")==="Default sidebar")');
    await driver.wait('return !!document.querySelector(".ycp-native-return-slot").shadowRoot.querySelector("button");');
    point = await driver.evaluate('const b=document.querySelector(".ycp-native-return-slot").shadowRoot.querySelector("button").getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};');
    await driver.actions({ "actions": [{ "type": "pointer", "id": "mouse", "parameters": { "pointerType": "mouse" }, "actions": [{ "type": "pointerMove", "duration": 30, "origin": "viewport", ...point }] }] });
    await driver.wait("return Array.from(" + root + '.querySelectorAll(".g-tooltip")).some(e=>/my clouds/i.test(e.textContent));');
    tooltip = await driver.evaluate("const e=Array.from(" + root + '.querySelectorAll(".g-tooltip")).find(e=>/my clouds/i.test(e.textContent)),b=e.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height,w:innerWidth,h:innerHeight};');
    assert.ok(tooltip["width"] > 0 && tooltip["height"] > 0 && tooltip["x"] >= 0 && tooltip["y"] >= 0 && tooltip["right"] <= tooltip["w"] && tooltip["bottom"] <= tooltip["h"], JSON.stringify(tooltip));
    await driver.click('document.querySelector(".ycp-native-return-slot").shadowRoot.querySelector("button")');
    await driver.wait("return !!" + root + '.querySelector(".ycp-cloud");');
    await driver.evaluate("fixture.checkMountAfter=performance.now()+2100;return true;");
    await driver.wait("return performance.now()>=fixture.checkMountAfter;");
    assert.ok(equal(await driver.evaluate('return [document.querySelectorAll("[data-ycp-host]").length,document.querySelectorAll(".ycp-native-return-slot").length];'), [1, 1]));
    assert.ok(equal(await driver.evaluate('return document.querySelectorAll("[data-list-item=\\"cloud.cloud-alpha\\"] .ycp-add-native").length;'), 1));
    return { "scenario": scenario, "staleNodes": "old host, return slot and inactive plus removed", "selection": "new native plus works", "tooltip": "return hint remains in viewport", "remount": "no duplicate controls after timer ticks" };
  }
  if (equal(scenario, "delayed-native-selection")) {
    root = 'document.querySelector("[data-ycp-host]").shadowRoot';
    async function current_cloud() {
      return "Array.from(" + root + '.querySelectorAll(".ycp-cloud[data-current]")).map(e=>e.closest("[data-cloud-id]").dataset.cloudId)';
    }
    await driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelectorAll(".ycp-cloud").length===2;');
    await driver.wait("return JSON.stringify(" + await current_cloud() + ')==="[\\"cloud-alpha\\"]";');
    assert.ok(equal(await driver.evaluate("return " + root + '.querySelector("[data-cloud-id=cloud-alpha] .ycp-link").getAttribute("aria-current");'), "page"));
    assert.ok(equal(await driver.evaluate("return location.pathname;"), "/folders/unknown-folder/dashboard"));
    assert.ok(equal(await driver.evaluate("return fixture.expansionClicks;"), 0));
    assert.ok(!await driver.evaluate("return !!" + root + '.querySelector(".ycp-folder");'));
    await driver.evaluate('fixture.selectNativeCloud("cloud-beta");return true;');
    await driver.wait("return JSON.stringify(" + await current_cloud() + ')==="[\\"cloud-beta\\"]";');
    assert.ok(equal(await driver.evaluate("return location.pathname;"), "/folders/unknown-folder/dashboard"));
    assert.ok(equal(await driver.evaluate("return " + root + '.querySelector("[data-cloud-id=cloud-beta] .ycp-link").getAttribute("aria-current");'), "page"));
    await driver.evaluate('fixture.selectNativeCloud(null);fixture.showHeaderCloud("cloud-alpha");return true;');
    await driver.wait("return JSON.stringify(" + await current_cloud() + ')==="[\\"cloud-alpha\\"]";');
    await driver.evaluate('fixture.showHeaderCloud("cloud-beta");return true;');
    await driver.wait("return JSON.stringify(" + await current_cloud() + ')==="[\\"cloud-beta\\"]";');
    await driver.evaluate('fixture.showHeaderCloud("cloud-unrecognized");return true;');
    await driver.wait("return " + await current_cloud() + ".length===0;");
    assert.ok(!await driver.evaluate("return !!" + root + '.querySelector(".ycp-cloud .ycp-link[aria-current=page]");'));
    assert.ok(equal(await driver.evaluate("return fixture.expansionClicks;"), 0));
    return { "scenario": scenario, "currentCloud": "native selection and semantic header identify uncached folder owner", "updates": "same URL reflects changed native selection", "unknownCloud": "no highlight", "cloudsOnly": "no folder scans" };
  }
  if (equal(scenario, "delayed-tooltips")) {
    root = 'document.querySelector("[data-ycp-host]").shadowRoot';
    await driver.wait('return !!document.querySelector("[data-ycp-host]")?.shadowRoot.querySelector(".ycp-folder");');
    await driver.wait("return !" + root + '.querySelector(".ycp-status");', { timeout: 25 });
    geometry = "const r=" + root + ';return [r.querySelector(".ycp-header"),r.querySelector(".ycp-cloud")].map(e=>{const b=e.getBoundingClientRect();return [b.x,b.y,b.width,b.height]});';
    before = await driver.evaluate(geometry);
    await driver.click("Array.from(" + root + '.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Refresh clouds")');
    await driver.wait("return !!" + root + '.querySelector(".ycp-status");');
    during = await driver.evaluate(geometry);
    assert.ok(equal(during, before), JSON.stringify({ "before": before, "during": during }));
    assert.ok(await driver.evaluate("const e=" + root + '.querySelector(".ycp-status");return ["absolute","fixed"].includes(getComputedStyle(e).position);'));
    assert.ok(equal(await driver.evaluate("return " + root + '.querySelectorAll("[title]").length;'), 0));
    await driver.wait("return /Loading|Reading/.test(" + root + '.querySelector(".ycp-refresh").dataset.ycpTooltip);');
    point = await driver.evaluate("const b=" + root + '.querySelector(".ycp-refresh").getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};');
    await driver.actions({ "actions": [{ "type": "pointer", "id": "mouse", "parameters": { "pointerType": "mouse" }, "actions": [{ "type": "pointerMove", "duration": 30, "origin": "viewport", ...point }] }] });
    await driver.wait("return Array.from(" + root + '.querySelectorAll(".g-tooltip")).some(e=>/Loading|Reading/.test(e.textContent));');
    assert.ok(!await driver.evaluate('return !!document.querySelector(".g-tooltip");'));
    await driver.wait("return !" + root + '.querySelector(".ycp-status");', { timeout: 25 });
    await driver.wait("return !Array.from(" + root + '.querySelectorAll(".g-tooltip")).some(e=>/Loading|Reading/.test(e.textContent));');
    assert.ok(equal(await driver.evaluate(geometry), before));
    point = await driver.evaluate("const b=" + root + '.querySelector(".ycp-cloud .ycp-link").getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};');
    await driver.actions({ "actions": [{ "type": "pointer", "id": "mouse", "parameters": { "pointerType": "mouse" }, "actions": [{ "type": "pointerMove", "duration": 30, "origin": "viewport", ...point }] }] });
    await driver.wait("return Array.from(" + root + '.querySelectorAll(".g-tooltip")).some(e=>e.textContent.includes("Alpha core")&&e.textContent.includes("cloud-alpha"));');
    await driver.evaluate(root + '.querySelector(".ycp-cloud .ycp-link").focus();return true;');
    await driver.actions({ "actions": [{ "type": "pointer", "id": "mouse", "parameters": { "pointerType": "mouse" }, "actions": [{ "type": "pointerMove", "duration": 30, "origin": "viewport", "x": 900, "y": 500 }] }] });
    await driver.wait("return " + root + ".activeElement===" + root + '.querySelector(".ycp-cloud .ycp-link")&&Array.from(' + root + '.querySelectorAll(".g-tooltip")).some(e=>e.textContent.includes("Alpha core")&&e.textContent.includes("cloud-alpha"));');
    await driver.actions({ "actions": [{ "type": "key", "id": "keyboard", "actions": [{ "type": "keyDown", "value": "Escape" }, { "type": "keyUp", "value": "Escape" }] }] });
    await driver.wait("return !" + root + '.querySelector(".g-tooltip");');
    await driver.click(root + '.querySelector(".ycp-toggle button")');
    assert.ok(await driver.evaluate('return document.querySelector(".ycp-add-native").hasAttribute("title");') === false);
    point = await driver.evaluate('const b=document.querySelector(".ycp-add-native").getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};');
    await driver.actions({ "actions": [{ "type": "pointer", "id": "mouse", "parameters": { "pointerType": "mouse" }, "actions": [{ "type": "pointerMove", "duration": 30, "origin": "viewport", "x": point["x"] - 40, "y": point["y"] }] }] });
    await driver.wait('return getComputedStyle(document.querySelector(".ycp-add-native")).opacity==="1";');
    await driver.actions({ "actions": [{ "type": "pointer", "id": "mouse", "parameters": { "pointerType": "mouse" }, "actions": [{ "type": "pointerMove", "duration": 30, "origin": "viewport", ...point }] }] });
    await driver.wait("return Array.from(" + root + '.querySelectorAll(".g-tooltip")).some(e=>/my clouds/i.test(e.textContent));');
    return { "scenario": scenario, "layout": "header and first cloud remain fixed during refresh", "tooltips": "live loading, cloud identity and native selection use shadow-local Gravity tooltips", "nativeTitles": "absent from extension controls" };
  }
  if (equal(scenario, "delayed-cloud-icons")) {
    root = 'document.querySelector("[data-ycp-host]").shadowRoot';
    cloud = root + '.querySelector("[data-cloud-id=cloud-alpha] .ycp-cloud")';
    prefs = 'fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"]';
    await driver.wait('return !!document.querySelector("[data-ycp-host]")?.shadowRoot.querySelector(".ycp-cloud");');
    default_icon = await driver.evaluate("return " + cloud + '.querySelector(".ycp-item-icon .g-icon").innerHTML;');
    async function edit_cloud() {
      await driver.wait("return !" + root + '.querySelector(".ycp-status");', { timeout: 25 });
      await driver.click("Array.from(" + cloud + '.querySelectorAll("button")).find(b=>b.dataset.ycpTooltip==="Label and color")');
      await driver.wait("return !!" + root + '.querySelector(".ycp-edit");');
    }
    await edit_cloud();
    initial_label = await driver.evaluate("return " + root + '.querySelector(".ycp-edit input").value;');
    await driver.evaluate("const e=" + root + '.querySelector(".ycp-edit input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"Unsaved cloud draft");e.dispatchEvent(new Event("input",{bubbles:true}));return true;');
    await driver.click("Array.from(" + cloud + '.querySelectorAll("button")).find(b=>b.dataset.ycpTooltip==="Label and color")');
    await driver.wait("return !" + root + '.querySelector(".ycp-edit");');
    assert.ok(equal(await driver.evaluate("return Array.from(" + cloud + '.querySelectorAll("button")).find(b=>b.dataset.ycpTooltip==="Label and color").getAttribute("aria-expanded");'), "false"));
    assert.ok(!await driver.evaluate("return !!" + prefs + '.custom["cloud:cloud-alpha"];'));
    await edit_cloud();
    assert.ok(equal(await driver.evaluate("return " + root + '.querySelector(".ycp-edit input").value;'), initial_label));
    assert.ok(equal(await driver.evaluate("return Array.from(" + cloud + '.querySelectorAll("button")).find(b=>b.dataset.ycpTooltip==="Label and color").getAttribute("aria-expanded");'), "true"));
    assert.ok(equal(await driver.evaluate("return Array.from(" + root + '.querySelectorAll(".ycp-icons [role=row]")).map(e=>e.querySelectorAll("button").length);'), [8, 8, 8]));
    assert.ok(await driver.evaluate("return !!" + root + '.querySelector(".ycp-icons button[value=cloud]")&&!' + root + '.querySelector(".ycp-icons button[value=folder]");'));
    rocket = await driver.evaluate("return " + root + '.querySelector(".ycp-icons button[value=rocket] .g-icon").innerHTML;');
    await driver.click(root + '.querySelector(".ycp-icons button[value=rocket]")');
    await driver.click(root + '.querySelector(".ycp-edit button[type=submit]")');
    await driver.wait("return " + prefs + '.custom["cloud:cloud-alpha"]?.icon==="rocket";');
    assert.ok(equal(await driver.evaluate("return " + cloud + '.querySelector(".ycp-item-icon .g-icon").innerHTML;'), rocket));
    await driver.navigate({ "url": origin + "/tests/fixtures/native-tree.html?scenario=delayed-cloud-icons" });
    await driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelector(".ycp-cloud .ycp-item-icon .g-icon")?.innerHTML===' + JSON.stringify(rocket) + ";");
    for (const path of ["/clouds/cloud-alpha", "/clouds/cloud-alpha/folder-alpha", "/folders/folder-alpha"]) {
      await driver.evaluate('history.pushState(null,"",' + JSON.stringify(path) + ');window.dispatchEvent(new PopStateEvent("popstate"));return true;');
      await driver.wait("return " + cloud + '.hasAttribute("data-current")&&' + cloud + '.querySelector(".ycp-link").getAttribute("aria-current")==="page";');
    }
    await driver.evaluate('history.pushState(null,"","/clouds/cloud-beta");window.dispatchEvent(new PopStateEvent("popstate"));return true;');
    await driver.wait("return !" + cloud + '.hasAttribute("data-current")&&!' + cloud + '.querySelector(".ycp-link").hasAttribute("aria-current");');
    await driver.evaluate("browser.storage.local.set({cloudOnlyHosts:[]});return true;");
    await driver.wait("return !!" + cloud + '.querySelector(":scope > button:first-child[aria-expanded]");');
    assert.ok(equal(await driver.evaluate("return " + cloud + '.querySelector(".ycp-item-icon .g-icon").innerHTML;'), default_icon));
    await edit_cloud();
    assert.ok(!await driver.evaluate("return !!" + root + '.querySelector(".ycp-icons");'));
    await driver.evaluate("const e=" + root + '.querySelector(".ycp-edit input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"Cloud renamed");e.dispatchEvent(new Event("input",{bubbles:true}));return true;');
    await driver.click(root + '.querySelector(".ycp-edit button[type=submit]")');
    await driver.wait("return " + prefs + '.custom["cloud:cloud-alpha"]?.label==="Cloud renamed";');
    assert.ok(equal(await driver.evaluate("return " + prefs + '.custom["cloud:cloud-alpha"].icon;'), "rocket"));
    await driver.evaluate("browser.storage.local.set({cloudOnlyHosts:[location.origin]});return true;");
    await driver.wait("return " + cloud + '.querySelector(".ycp-item-icon .g-icon").innerHTML===' + JSON.stringify(rocket) + ";");
    await edit_cloud();
    await driver.click("Array.from(" + root + '.querySelectorAll(".ycp-edit .ycp-actions button")).find(b=>b.textContent.trim()==="Auto")');
    await driver.wait("return !" + prefs + '.custom["cloud:cloud-alpha"];');
    assert.ok(equal(await driver.evaluate("return " + cloud + '.querySelector(".ycp-item-icon .g-icon").innerHTML;'), default_icon));
    return { "scenario": scenario, "cloudIcons": "24 presets saved across reload with Auto reset", "folderMode": "fixed cloud icon retains dormant customization", "currentCloud": "cloud, nested folder and folder-only routes highlight owner" };
  }
  if (equal(scenario, "delayed-clouds-only")) {
    root = 'document.querySelector("[data-ycp-host]").shadowRoot';
    await driver.wait('return !!document.querySelector("[data-ycp-host]")?.shadowRoot.querySelector(".ycp-cloud .ycp-link");');
    async function assert_clouds_only() {
      assert.ok(!await driver.evaluate("return !!" + root + '.querySelector(".ycp-folder,.ycp-cloud > button:first-child[aria-expanded]");'));
    }
    async function refresh_clouds() {
      await driver.click("Array.from(" + root + '.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Refresh clouds")');
      await driver.wait("return !" + root + '.querySelector(".ycp-status");', { timeout: 25 });
    }
    await assert_clouds_only();
    await refresh_clouds();
    assert.ok(equal(await driver.evaluate("return fixture.expansionClicks;"), 0));
    await assert_clouds_only();
    assert.ok((await driver.evaluate("return " + root + '.querySelector(".ycp-cloud .ycp-link").getAttribute("href");')).endsWith("/clouds/cloud-alpha"));
    await driver.evaluate("const link=" + root + '.querySelector(".ycp-cloud .ycp-link");link.addEventListener("click",e=>{e.preventDefault();fixture.cloudLinkClicked=true},{once:true});return true;');
    await driver.click(root + '.querySelector(".ycp-cloud .ycp-link")');
    assert.ok(await driver.evaluate("return fixture.cloudLinkClicked;"));
    await driver.click(root + '.querySelector(".ycp-toggle button")');
    await driver.click('document.querySelector("[data-list-item=\\"cloud.cloud-beta\\"] .ycp-add-native")');
    await driver.wait('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"].mine.includes("cloud-beta");');
    await driver.click(root + '.querySelector(".ycp-toggle button")');
    await driver.wait("return " + root + '.querySelectorAll(".ycp-cloud").length===2;');
    await assert_clouds_only();
    assert.ok(equal(await driver.evaluate("return fixture.expansionClicks;"), 0));
    await driver.evaluate('const key="yc-power:"+location.origin+":organization:id:org-alpha",prefs=structuredClone(fixture.memory[key]);prefs.expandedClouds=[];history.pushState(null,"","/clouds/cloud-alpha/folder-alpha");browser.storage.local.set({[key]:prefs});return true;');
    await driver.wait("return !" + root + '.querySelector(".ycp-folder");');
    await driver.evaluate('browser.storage.local.set({cloudOnlyHosts:["https://other.example"]});return true;');
    await driver.wait("return !!" + root + '.querySelector("[data-cloud-id=cloud-alpha] .ycp-folder")&&fixture.expansionClicks>0;', { timeout: 25 });
    await driver.wait("return !" + root + '.querySelector(".ycp-status");', { timeout: 25 });
    await driver.evaluate("browser.storage.local.set({cloudOnlyHosts:[location.origin]});return true;");
    await driver.wait("return !" + root + '.querySelector(".ycp-folder,.ycp-cloud > button:first-child[aria-expanded]");');
    clicks = await driver.evaluate("return fixture.expansionClicks;");
    await refresh_clouds();
    assert.ok(equal(await driver.evaluate("return fixture.expansionClicks;"), clicks));
    await driver.navigate({ "url": origin + "/tests/fixtures/native-tree.html?scenario=delayed-clouds-only" });
    await driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelectorAll(".ycp-cloud").length===2;');
    await assert_clouds_only();
    await refresh_clouds();
    assert.ok(equal(await driver.evaluate("return fixture.expansionClicks;"), 0));
    return { "scenario": scenario, "cloudsOnly": "cached folders hidden and no native expansions", "clouds": "links and selection work", "settings": "live origin matching and reload persistence" };
  }
  if (scenario.startsWith("delayed")) {
    if (equal(scenario, "delayed-cache")) {
      await driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelector(".ycp-folder a")?.getAttribute("href").includes("folder-old");');
      await driver.wait('const r=document.querySelector("[data-ycp-host]").shadowRoot;return Array.from(r.querySelectorAll(".ycp-folder a")).some(e=>e.getAttribute("href").includes("folder-alpha"))&&!Array.from(r.querySelectorAll(".ycp-folder a")).some(e=>e.getAttribute("href").includes("folder-old"));', { timeout: 25 });
      assert.ok(equal(await driver.evaluate("return fixture.expansionClicks;"), 1));
      await driver.wait('return !document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-status");');
      await driver.evaluate('window.fixture.folderDisappeared=false;const r=document.querySelector("[data-ycp-host]").shadowRoot;new MutationObserver(()=>{if(!r.querySelector(".ycp-folder"))fixture.folderDisappeared=true}).observe(r,{childList:true,subtree:true});return true;');
      await driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Refresh clouds")');
      await driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-status");');
      await driver.wait('return !document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-status");', { timeout: 25 });
      assert.ok(!await driver.evaluate("return fixture.folderDisappeared;"));
      assert.ok(equal(await driver.evaluate("return fixture.expansionClicks;"), 1));
      return { "scenario": scenario, "cache": "rendered first", "backgroundRefresh": "fresh folders retained throughout repeated refresh" };
    }
    if (equal(scenario, "delayed-cancel")) {
      await driver.wait("return fixture.expansionClicks===1;");
      modern = await driver.evaluate('return Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).some(b=>b.getAttribute("aria-label")==="Show all organization clouds in this panel"&&!b.disabled);');
      assert.ok(modern);
      await driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).find(b=>b.getAttribute("aria-label")==="Show all organization clouds in this panel")');
      await driver.wait('return document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-cloud").length===3;');
      await driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).find(b=>b.getAttribute("aria-label")==="Show my clouds")');
      await driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Default sidebar")');
      await driver.wait('return !!document.querySelector(".ycp-native-return-slot")?.shadowRoot?.querySelector("button");');
      await driver.click('document.querySelector(".ycp-native-return-slot").shadowRoot.querySelector("button")');
    }
    try {
      await driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelector(".ycp-folder");', { timeout: 25 });
    } catch (error) {
      throw new Error(JSON.stringify(await driver.evaluate('return {scenario:fixture.scenario,clicks:fixture.expansionClicks,panel:document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-root").textContent,rows:document.querySelector(".cloud-tree-list").textContent};')));
    }
    assert.ok(equal(await driver.evaluate("return fixture.expansionClicks;"), 1));
    widths = await driver.evaluate("return [...new Set(fixture.widths)];");
    assert.ok(widths.length > 0 && widths.map((width) => Math.abs(width - 320) < 1).every(Boolean), JSON.stringify(widths));
    return { "scenario": scenario, "savedCloudFolders": "loaded automatically", "nativeExpansion": "once" };
  }
  ready = await driver.wait('const r=document.querySelector("[data-ycp-host]")?.shadowRoot;return r && r.querySelector(".ycp-toggle") && !r.textContent.includes("Loading cloud list") && !r.textContent.includes("Reading the console tree") && {count:r.querySelector(".ycp-toggle .g-text")?.textContent};');
  expected = equal(scenario, "virtual") ? "30" : equal(scenario, "small") ? "3" : "";
  if (expected) {
    assert.ok(equal(ready["count"], expected), JSON.stringify([scenario, ready, await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.textContent.slice(-500);')]));
  }
  text = await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-root").textContent;');
  assert.ok(!includes(text, "Could not read"), JSON.stringify(text));
  assert.ok(!await driver.evaluate('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-search");'));
  if (equal(scenario, "small")) {
    assert.ok(equal(await driver.evaluate('return getComputedStyle(document.querySelector("[data-ycp-host]")).backgroundColor;'), "rgb(243, 245, 247)"));
    for (const [theme, background, foreground] of [["dark-hc", "rgb(31, 37, 43)", "rgb(230, 235, 240)"], ["light-hc", "rgb(255, 255, 255)", "rgb(20, 25, 30)"]]) {
      await driver.evaluate('document.querySelector(".cloud-tree-list-container").style.backgroundColor=' + JSON.stringify(background) + ';document.body.style.setProperty("--g-color-text-primary",' + JSON.stringify(foreground) + ");document.body.className=" + JSON.stringify("g-root g-root_theme_" + theme) + ";return true;");
      await driver.wait('const h=document.querySelector("[data-ycp-host]");return getComputedStyle(h).backgroundColor===' + JSON.stringify(background) + ";");
      colors = await driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot;return {root:getComputedStyle(r.querySelector(".ycp-root")).backgroundColor,text:getComputedStyle(r.querySelector(".ycp-layout")).color};');
      assert.ok(equal(colors, { "root": "rgba(0, 0, 0, 0)", "text": foreground }), JSON.stringify(colors));
    }
  }
  if (equal(scenario, "virtual")) {
    return { "scenario": scenario, "clouds": ready["count"] };
  }
  await driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-toggle button")');
  selected = equal(scenario, "multi") ? "cloud-beta" : "cloud-alpha";
  await driver.click('document.querySelector("[data-list-item=\\"cloud.' + selected + '\\"] .ycp-add-native")');
  await driver.wait('return document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-cloud").length===1;');
  text = await driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-root").textContent;');
  assert.ok(includes(text, equal(scenario, "multi") ? "Beta organization" : "Alpha organization"), JSON.stringify(text));
  assert.ok(includes(text, equal(scenario, "multi") ? "Beta" : "Alpha"), JSON.stringify(text));
  if (equal(scenario, "small")) {
    await driver.evaluate("browser.storage.local.set({compactDensity:true});return true;");
    await driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector("[data-compact]");');
    compact = await driver.evaluate('const row=document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-cloud");return {height:row.getBoundingClientRect().height,children:Array.from(row.children).map(e=>({height:e.getBoundingClientRect().height,font:getComputedStyle(e).lineHeight}))};');
    assert.ok(equal(compact["height"], 28), JSON.stringify(compact));
    spacing = await driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot,row=r.querySelector(".ycp-cloud"),group=row.closest(".ycp-group");return {gap:getComputedStyle(group).rowGap,padding:getComputedStyle(group).paddingTop,buttons:Array.from(row.querySelectorAll("button")).map(b=>({hit:b.getBoundingClientRect().height,inset:getComputedStyle(b,"::before").top,icon:b.querySelector("svg.g-icon")?.getBoundingClientRect().width}))};');
    assert.ok(equal(spacing["gap"], "2px") && equal(spacing["padding"], "2px"), JSON.stringify(spacing));
    assert.ok(spacing["buttons"].map((b) => equal(b, { "hit": 28, "inset": "2px", "icon": 16 })).every(Boolean), JSON.stringify(spacing));
    await driver.evaluate("browser.storage.local.set({compactDensity:false});return true;");
    await driver.wait('return !document.querySelector("[data-ycp-host]").shadowRoot.querySelector("[data-compact]");');
  }
  geometry = await driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot;const row=r.querySelector(".ycp-cloud");const centers=Array.from(row.children).map(e=>{const b=e.getBoundingClientRect();return b.y+b.height/2});return {delta:Math.max(...centers)-Math.min(...centers),refresh:Array.from(row.querySelectorAll("button")).some(b=>b.getAttribute("aria-label")==="Refresh folders"),footer:!!r.querySelector(".ycp-footer")};');
  assert.ok(geometry["delta"] < 1 && !geometry["refresh"] && !geometry["footer"], JSON.stringify(geometry));
  await driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-toggle button")');
  tree_style = await driver.evaluate('const s=getComputedStyle(document.querySelector(".cloud-tree-list-container"));return {visibility:s.visibility,opacity:s.opacity};');
  assert.ok(equal(tree_style, { "visibility": "visible", "opacity": "1" }), JSON.stringify(tree_style));
  icon = await driver.evaluate('const r=document.querySelector(".header-icon").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:innerWidth,h:innerHeight};');
  screenshot = await driver.screenshot({ "full": false, "scroll": false });
  [value] = pixel(screenshot, icon["x"], icon["y"]);
  assert.ok(zip(value, [52, 143, 255]).map(([a, b]) => Math.abs(a - b) < 6).every(Boolean), JSON.stringify(["Shared SVG disappeared", value]));
  await driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector("button[aria-label=\\"Default sidebar\\"]")');
  await driver.wait('return !!document.querySelector(".ycp-native-return-slot")?.shadowRoot?.querySelector("button");');
  alignment = await driver.evaluate('const a=document.querySelector(".ycp-native-return-slot").shadowRoot.querySelector("button").getBoundingClientRect();const b=document.querySelector("#native-toggle").getBoundingClientRect();return Math.abs((a.y+a.height/2)-(b.y+b.height/2));');
  assert.ok(alignment < 2, JSON.stringify(alignment));
  await driver.click('document.querySelector(".ycp-native-return-slot").shadowRoot.querySelector("button")');
  await driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-header");');
  await driver.evaluate("window.scrollTo(0,200);return true;");
  await driver.wait('return Math.abs(document.querySelector("[data-ycp-aside]").getBoundingClientRect().top)<1;');
  return { "scenario": scenario, "plus": "visible selection", "sharedSvg": "visible", "returnIcon": "aligned", "sticky": "preserved" };
}

const scenarios = ["options-two-hosts", "options-clouds-only", "options-denied", "small", "stale-mount", "multi", "virtual", "delayed", "delayed-cancel", "delayed-controls", "retry-startup", "retry-empty", "retry-defers", "retry-permanent", "startup-container-late", "startup-container-late5s", "startup-tree-replaced", "startup-late-attribute", "startup-late-empty-text", "startup-poll-fallback", "delayed-cache", "delayed-tooltips", "delayed-native-selection", "delayed-clouds-only", "delayed-cloud-icons", "multi-saved", "multi-grouped", "multi-regional", "empty-cache", "expand-state", "folder-icons", "folder-order", "empty-cloud", "becomes-empty", "cloud-order", "cloud-order-scroll", "failed"];
test.use({viewport: {width: 1200, height: 800}, deviceScaleFactor: 1});
for (const scenario of scenarios) {
  test(scenario, async ({page, baseURL}, testInfo) => {
    test.setTimeout(120000);
    const result = await exercise(new FixtureDriver(page), baseURL, scenario);
    await testInfo.attach('scenario-result', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
  });
}

const transferOrganizationKey = 'yc-power:https://alpha.example:organization:id:org-alpha';
const initialTransferSettings = {
  domainHosts: ['https://console.yandex.cloud', 'https://alpha.example'],
  cloudOnlyHosts: [],
  compactDensity: false,
  [transferOrganizationKey]: {
    mine: ['cloud-alpha'], initialized: true, expandedClouds: ['cloud-alpha'], width: 320,
    custom: {'cloud:cloud-alpha': {label: 'Original alpha', color: 'blue', icon: 'rocket'}},
  },
};

async function downloadSettings(page) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export settings', exact: true}).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('yc-power-settings.json');
  const text = await readFile(await download.path(), 'utf8');
  const envelope = JSON.parse(text);
  expect(text).toBe(JSON.stringify(envelope, null, 2) + '\n');
  expect(envelope.format).toBe('yc-power-settings');
  expect(envelope.version).toBe(1);
  return envelope;
}

async function openTransferFixture(page, scenario) {
  await page.goto('/tests/fixtures/options.html?scenario=' + scenario);
  await expect(page.locator('.domain-row input').first()).toBeEnabled();
  await page.evaluate(async settings => {
    await browser.storage.local.set(settings);
  }, initialTransferSettings);
  await page.reload();
  await expect(page.locator('.domain-row input')).toHaveCount(2);
  await expect(page.locator('.domain-row input').first()).toBeEnabled();
  expect(await page.evaluate(() => fixture.writes)).toEqual([]);
}

for (const denied of [false, true]) {
  test('options transfer ' + (denied ? 'permission denial leaves imported settings uncommitted' : 'export and import roundtrip saves organization preferences'), async ({page}, testInfo) => {
    await openTransferFixture(page, denied ? 'options-denied' : 'options-transfer');
    const exported = await downloadSettings(page);
    expect(exported.settings).toEqual(initialTransferSettings);
    expect(await page.evaluate(() => fixture.writes)).toEqual([]);

    const imported = structuredClone(exported);
    imported.settings.compactDensity = true;
    imported.settings.domainHosts.push('https://beta.example');
    imported.settings.cloudOnlyHosts = ['https://beta.example'];
    imported.settings[transferOrganizationKey].custom['cloud:cloud-alpha'].label = 'Imported alpha';
    imported.settings[transferOrganizationKey].custom['folder:folder-alpha'] = {label: 'Imported folder', color: 'green', icon: 'star'};
    await page.locator('input[type=file]').setInputFiles({
      name: 'synthetic-settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported, null, 2)),
    });
    await expect(page.getByRole('status')).toHaveText('Settings loaded from JSON. Save to apply them');
    await expect(page.locator('input[type=checkbox]')).toBeChecked();
    await expect(page.locator('.domain-row input')).toHaveCount(3);
    expect(await page.evaluate(() => fixture.memory)).toEqual(initialTransferSettings);
    expect(await page.evaluate(() => fixture.writes)).toEqual([]);
    expect(await page.evaluate(() => fixture.requests)).toEqual([]);

    await page.getByRole('button', {name: 'Save', exact: true}).click();
    await expect(page.getByRole('status')).toHaveText(denied ? 'Access was not granted. Settings have not changed' : 'Saved. The extension is enabled for the selected addresses');
    expect(await page.evaluate(() => fixture.requests)).toEqual([{origins: imported.settings.domainHosts.map(host => host + '/*')}]);
    if (denied) {
      expect(await page.evaluate(() => fixture.memory)).toEqual(initialTransferSettings);
      expect(await page.evaluate(() => fixture.writes)).toEqual([]);
    } else {
      expect(await page.evaluate(() => fixture.memory)).toEqual(imported.settings);
      expect(await page.evaluate(() => fixture.writes)).toEqual([imported.settings]);
    }

    await page.reload();
    await expect(page.locator('.domain-row input').first()).toBeEnabled();
    const expected = denied ? initialTransferSettings : imported.settings;
    await expect.poll(() => page.locator('.domain-row input').evaluateAll(inputs => inputs.map(input => input.value))).toEqual(expected.domainHosts);
    if (denied) await expect(page.locator('input[type=checkbox]')).not.toBeChecked();
    else await expect(page.locator('input[type=checkbox]')).toBeChecked();
    expect((await downloadSettings(page)).settings).toEqual(expected);

    if (!denied) {
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({colorScheme});
        await expect(page.locator('.g-root')).toHaveClass(new RegExp('g-root_theme_' + colorScheme));
        await testInfo.attach('options-transfer-' + colorScheme, {body: await page.screenshot({fullPage: true}), contentType: 'image/png'});
      }
    }
  });
}
