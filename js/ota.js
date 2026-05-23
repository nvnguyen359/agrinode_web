// ota.js - Quản lý Cập nhật Firmware (Over-The-Air)
const OTA = {
    autoCheckUpdate: async function() {
        if (State.CURRENT_VERSION === "Unknown") return;
        try {
            const checkUrl = Config.GITHUB_VERSION_URL + "?t=" + new Date().getTime();
            const res = await fetch(checkUrl, { cache: "no-store" });
            const vData = await res.json();
            
            // Xử lý cứng: Nếu phiên bản trên mạch != phiên bản trên Github thì mới hiển thị prompt báo mới.
            if (vData.version && vData.version !== State.CURRENT_VERSION) {
                UI.updateVersionUI(State.CURRENT_VERSION, vData.version);
                UI.toggleOtaBadge(true); 
                
                const msg = `Phát hiện phiên bản mới: v${vData.version} (Hiện tại: v${State.CURRENT_VERSION})\n\n[Tính năng mới]\n${vData.release_notes || 'Bản vá lỗi'}\n\nBạn có muốn cập nhật ngay bây giờ không?`;
                UI.showConfirm("Cập nhật phần mềm", msg, () => {
                    OTA.executeOtaUpdate(vData.firmware_url);
                }, "🚀");
            } else {
                UI.updateVersionUI(State.CURRENT_VERSION); 
                UI.toggleOtaBadge(false);
            }
        } catch (e) { console.log("Auto update check ngầm bị lỗi: ", e); }
    },

    promptUpdate: async function(forceCheck = false) {
        if (forceCheck) UI.showLoading("Đang kiểm tra phiên bản...");
        try {
            const checkUrl = Config.GITHUB_VERSION_URL + "?t=" + new Date().getTime();
            const res = await fetch(checkUrl, { cache: "no-store" });
            const vData = await res.json();
            if (forceCheck) UI.hideLoading();

            if (!vData.version || !vData.firmware_url) return UI.showAlert("Lỗi", "File JSON trên GitHub không hợp lệ.", "❌");
            
            if (vData.version === State.CURRENT_VERSION) {
                UI.updateVersionUI(State.CURRENT_VERSION);
                UI.toggleOtaBadge(false);
                return UI.showAlert("Thông báo", `🎉 Thiết bị của bạn đang ở phiên bản mới nhất (v${State.CURRENT_VERSION}). Không cần cập nhật!`, "✅");
            }

            UI.updateVersionUI(State.CURRENT_VERSION, vData.version);
            UI.toggleOtaBadge(true);

            const msg = `Phát hiện phiên bản mới: v${vData.version}\n\n[Tính năng mới]\n${vData.release_notes || 'Bản vá lỗi'}\n\nBạn có muốn cập nhật thiết bị ngay bây giờ không?`;
            UI.showConfirm("Cập nhật phần mềm", msg, () => {
                OTA.executeOtaUpdate(vData.firmware_url);
            }, "🚀");

        } catch (e) {
            if (forceCheck) UI.hideLoading();
            UI.showAlert("Lỗi mạng", "Không thể lấy thông tin phiên bản từ GitHub!", "🌐");
        }
    },

    executeOtaUpdate: async function(targetFirmwareUrl) {
        UI.showOtaProgress(0); // BẬT MÀN HÌNH CHỜ TIẾN TRÌNH

        if (Config.isLocal) {
            try {
                const res = await fetch('/api/ota/cloud', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ url: targetFirmwareUrl })
                });
                const data = await res.json();
                if (!data.success) {
                    UI.closeModal('modal-ota-progress');
                    UI.showAlert("Từ chối", "Mạch từ chối lệnh nạp!", "❌");
                }
            } catch(e) { 
                // Vẫn đang nạp, chờ MQTT bắn tiến trình tới
            }
        } else {
            const payload = { cmd: "update", url: targetFirmwareUrl };
            Network.sendAction(payload, null, () => {
                UI.toggleOtaBadge(false);
            });
        }
    }
};