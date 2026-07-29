(() => {
  const connectButton = document.querySelector("#connect-button");
  const deviceName = document.querySelector("#device-name");
  const deviceDetail = document.querySelector("#device-detail");
  const statusBadge = document.querySelector("#status-badge");
  const message = document.querySelector("#message");
  const artStatus = document.querySelector("#art-status");
  const steps = {
    connect: document.querySelector("#step-connect"),
    ready: document.querySelector("#step-ready"),
    send: document.querySelector("#step-send")
  };

  const api = window["ticalc-usb"];
  let calculator;
  let running = false;

  function setBadge(text, state) {
    statusBadge.textContent = text;
    statusBadge.className = `badge ${state}`;
  }

  function setMessage(text, state = "") {
    message.textContent = text;
    message.className = `message ${state}`.trim();
  }

  function setStep(name, state) {
    steps[name].className = state;
  }

  function resetSteps() {
    Object.values(steps).forEach(step => { step.className = ""; });
  }

  function withTimeout(promise, milliseconds, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error(`${label} timed out. Reconnect the USB cable and try again.`)), milliseconds);
      })
    ]);
  }

  function exitVariable() {
    return {
      calcType: "TI-84 Plus",
      entries: [{
        name: "EXITMODE",
        type: 0x15,
        size: 1,
        data: new Uint8Array([0]),
        attributes: { archived: false, version: 0 }
      }]
    };
  }

  function useCeVariableHeader(device) {
    device._entryParameters = entry => new Uint8Array([
      0x00, 0x03,
      0x00, 0x02, 0x00, 0x04, 0xF0, 0x0F, 0x00, entry.type,
      0x00, 0x03, 0x00, 0x01, entry.attributes?.archived ? 1 : 0,
      0x00, 0x08, 0x00, 0x04, 0x00, 0x00, 0x00, entry.attributes?.version || 0
    ]);
  }

  async function exitTestMode(device) {
    if (running) return;
    running = true;
    calculator = device;
    connectButton.disabled = true;
    resetSteps();

    try {
      setStep("connect", "active");
      setBadge("Connected", "busy");
      deviceName.textContent = calculator.name;
      deviceDetail.textContent = "USB link established";
      setMessage("Calculator found. Starting the TI direct-USB handshake…");
      setStep("connect", "done");

      setStep("ready", "active");
      const ready = await withTimeout(calculator.isReady(), 7000, "Calculator handshake");
      if (!ready) {
        throw new Error("The calculator did not answer. Make sure it is turned on and showing the home or test-mode screen.");
      }
      setStep("ready", "done");

      setStep("send", "active");
      setBadge("Sending", "busy");
      setMessage("Sending a harmless one-byte AppVar named EXITMODE…");
      useCeVariableHeader(calculator);
      await withTimeout(calculator.sendFile(exitVariable()), 10000, "File transfer");
      setStep("send", "done");

      setBadge("Complete", "good");
      setMessage("Transfer complete. The calculator should now be out of test mode. Press any key on it if the screen has not refreshed.", "success");
      deviceDetail.textContent = "Normal mode signal sent";
      artStatus.textContent = "UNLOCKED";
      connectButton.querySelector("span").textContent = "Run again";
    } catch (error) {
      console.error(error);
      const detail = typeof error === "string" ? error : error?.message;
      setBadge("Error", "bad");
      setMessage(detail || "The transfer failed. Reconnect the calculator and try again.", "error");
      artStatus.textContent = "RETRY";
    } finally {
      connectButton.disabled = false;
      running = false;
    }
  }

  async function initialize() {
    if (!api?.ticalc || !api.ticalc.browserSupported()) {
      connectButton.disabled = true;
      setBadge("Unsupported", "bad");
      setMessage("WebUSB is unavailable. Open this page in desktop Google Chrome or Microsoft Edge.", "error");
      return;
    }

    api.ticalc.addEventListener("connect", exitTestMode);

    try {
      await api.ticalc.init({ supportLevel: "beta" });
    } catch (error) {
      console.debug("No previously authorized calculator found", error);
    }
  }

  connectButton.addEventListener("click", async () => {
    resetSteps();
    setStep("connect", "active");
    setBadge("Selecting", "busy");
    setMessage("Choose “TI-84 Plus CE” in Chrome’s USB device dialog.");
    connectButton.disabled = true;

    try {
      await api.ticalc.choose();
    } catch (error) {
      const cancelled = error?.name === "NotFoundError";
      setBadge(cancelled ? "Waiting" : "Error", cancelled ? "idle" : "bad");
      setMessage(cancelled ? "No calculator was selected. Click the button when you are ready." : (error?.message || String(error)), cancelled ? "" : "error");
      setStep("connect", "");
    } finally {
      if (!running) connectButton.disabled = false;
    }
  });

  navigator.usb?.addEventListener("disconnect", event => {
    if (calculator && event.device.productName?.includes("TI-84")) {
      setBadge("Disconnected", "idle");
      deviceDetail.textContent = "Reconnect USB to run again";
    }
  });

  initialize();
})();
