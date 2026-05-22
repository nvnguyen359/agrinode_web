// ota.js - Quản lý Cập nhật Firmware (Over-The-Air)
const OTA = {
    autoCheckUpdate: async function() {
        if (State.CURRENT_VERSION === "Unknown") return;
        try {
            const checkUrl = Config.GITHUB_VERSION_URL + "?t=" + new Date().getTime();
            const res = await fetch(checkUrl, { cache: "no-store" });
            const vData = await res.json();
            
            if (vData.version && vData.version !== State.CURRENT_VERSION) {
                document.getElementById('current-version-text').innerHTML = `Phiên bản: v${State.CURRENT_VERSION} <span style="color:var(--alert-color); font-weight:bold;">(Có bản mới: v${vData.version})</span>`;
                
                // HIỂN THỊ ICON CẬP NHẬT TRÊN HEADER
                const otaBtn = document.getElementById('btn-ota-update');
                if (otaBtn) {
                    otaBtn.style.display = 'block';
                    document.getElementById('ota-badge').style.display = 'block';
                }
                
                const msg = `Phát hiện phiên bản mới: v${vData.version} (Hiện tại: v${State.CURRENT_VERSION})\n\n[Tính năng mới]\n${vData.release_notes || 'Bản vá lỗi'}\n\nBạn có muốn cập nhật ngay bây giờ không?`;
                UI.showConfirm("Cập nhật phần mềm", msg, () => {
                    OTA.executeOtaUpdate(vData.firmware_url);
                }, "🚀");
            } else {
                document.getElementById('current-version-text').innerText = `Phiên bản: v${State.CURRENT_VERSION} (Mới nhất)`;
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
                return UI.showAlert("Thông báo", `🎉 Thiết bị của bạn đang ở phiên bản mới nhất (v${State.CURRENT_VERSION}). Không cần cập nhật!`, "✅");
            }

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
        if (Config.isLocal) {
            UI.showLoading("Đang ra lệnh nạp firmware...");
            try {
                const res = await fetch('/api/ota/cloud', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ url: targetFirmwareUrl })
                });
                const data = await res.json();
                if (data.success) {
                    UI.showAlert("Đang nạp...", "Mạch đang tải và cập nhật. Quá trình mất khoảng 1-2 phút, vui lòng không rút điện.", "⚙️");
                } else { UI.showAlert("Từ chối", "Mạch từ chối lệnh nạp!", "❌"); }
            } catch(e) {
                UI.showAlert("Thành công", "Đã gửi lệnh! Mạch đang nạp và sẽ tự khởi động lại sau 1-2 phút.", "✅");
            }
            UI.hideLoading();
        } else {
            const payload = { cmd: "update", url: targetFirmwareUrl };
            Network.sendAction(payload, "Đang gửi lệnh OTA...", () => {
                UI.showAlert("Đã gửi lệnh", "Lệnh nâng cấp đã gửi qua Cloud. Mạch sẽ tự tải code từ GitHub, vui lòng đợi 1-2 phút!", "☁️");
                document.getElementById('btn-ota-update').style.display = 'none'; // Ẩn nút báo
            });
        }
    }
};