import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";

export default function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Redirect non-admins
  useEffect(() => {
    if (user?.role !== "admin") navigate("/home", { replace: true });
  }, [user]);

  // ── Cycle state ──────────────────────────────────────────────────────────────
  const [cycles, setCycles] = useState([]);
  const [cyclesLoading, setCyclesLoading] = useState(true);
  const [cycleModalOpen, setCycleModalOpen] = useState(false);
  const [newCycleId, setNewCycleId] = useState("");
  const [cycleError, setCycleError] = useState("");
  const [cycleWorking, setCycleWorking] = useState(false);
  const [switchingId, setSwitchingId] = useState(null);

  // ── User state ───────────────────────────────────────────────────────────────
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [newPin, setNewPin] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [userError, setUserError] = useState("");
  const [userWorking, setUserWorking] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  async function fetchCycles() {
    setCyclesLoading(true);
    const { data } = await supabase
      .from("cycles")
      .select("id, status")
      .order("id", { ascending: false });
    setCycles(data ?? []);
    setCyclesLoading(false);
  }

  async function fetchUsers() {
    setUsersLoading(true);
    const { data } = await supabase
      .from("users")
      .select("id, pin, display_name, role")
      .order("role")
      .order("display_name");
    setUsers(data ?? []);
    setUsersLoading(false);
  }

  useEffect(() => {
    fetchCycles();
    fetchUsers();
  }, []);

  // ── Cycle actions ────────────────────────────────────────────────────────────
  async function handleSwitchCycle(id) {
    setSwitchingId(id);
    setCycleError("");
    // Activate target first — if this fails, nothing changes
    const { error: e1 } = await supabase
      .from("cycles")
      .update({ status: "active" })
      .eq("id", id);
    if (e1) {
      setCycleError("Lỗi chuyển chu kỳ.");
      setSwitchingId(null);
      return;
    }
    // Then close all other active cycles
    const { error: e2 } = await supabase
      .from("cycles")
      .update({ status: "closed" })
      .eq("status", "active")
      .neq("id", id);
    if (e2) {
      setCycleError("Lỗi chuyển chu kỳ.");
      setSwitchingId(null);
      return;
    }
    setSwitchingId(null);
    setCycleModalOpen(false);
    fetchCycles();
  }

  async function handleCreateCycle() {
    const id = newCycleId.trim();
    if (!/^\d{4}-\d{2}$/.test(id)) {
      setCycleError("Định dạng phải là YYYY-MM (ie. 2026-04)");
      return;
    }
    setCycleWorking(true);
    setCycleError("");
    // Insert new cycle as active first — if this fails, nothing changes
    const { error } = await supabase
      .from("cycles")
      .insert({ id, status: "active", created_by: user.id });
    if (error) {
      setCycleError(
        error.code === "23505" ? "Chu kỳ này đã tồn tại." : "Lỗi tạo chu kỳ.",
      );
      setCycleWorking(false);
      return;
    }
    // Then close all previously active cycles
    await supabase
      .from("cycles")
      .update({ status: "closed" })
      .eq("status", "active")
      .neq("id", id);
    setNewCycleId("");
    setCycleWorking(false);
    setCycleModalOpen(false);
    fetchCycles();
  }

  // ── User actions ─────────────────────────────────────────────────────────────
  async function handleAddUser() {
    const pin = newPin.trim();
    const name = newName.trim();
    if (!/^\d{4}$/.test(pin)) {
      setUserError("PIN phải là 4 chữ số.");
      return;
    }
    if (!name) {
      setUserError("Tên không được để trống.");
      return;
    }
    setUserWorking(true);
    setUserError("");
    const { error } = await supabase
      .from("users")
      .insert({ pin, display_name: name, role: newRole });
    if (error) {
      setUserError(
        error.code === "23505"
          ? "PIN này đã được dùng."
          : "Lỗi thêm người dùng.",
      );
      setUserWorking(false);
      return;
    }
    setNewPin("");
    setNewName("");
    setNewRole("user");
    setUserWorking(false);
    fetchUsers();
  }

  async function handleDeleteUser(userId) {
    await supabase.from("users").delete().eq("id", userId);
    setConfirmDeleteId(null);
    fetchUsers();
  }

  if (user?.role !== "admin") return null;

  return (
    <div className="min-h-screen bg-gray-100 flex justify-center">
      <div className="w-full max-w-[480px] flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gray-100 px-4 pt-8 pb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/home")}
              className="p-1.5 -ml-1.5 rounded-xl text-gray-500 hover:bg-gray-200 active:bg-gray-300 transition-colors"
              aria-label="Quay lại"
            >
              <ChevronLeft size={22} />
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Cài đặt</h1>
          </div>
        </div>

        <div className="px-4 pb-12 flex flex-col gap-6">
          {/* ── Cycles ── */}
          <div>
            <p className="text-base font-bold text-gray-900 mb-3">Chu kỳ</p>

            {/* Active cycle card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-4 flex items-center justify-between">
              {cyclesLoading ? (
                <p className="text-sm text-gray-400">Đang tải...</p>
              ) : (
                (() => {
                  const active = cycles.find((c) => c.status === "active");
                  return active ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold text-gray-900">
                        {active.id}
                      </span>
                      <span className="text-[10px] font-bold bg-green-500 text-white px-1.5 py-0.5 rounded-md">
                        ACTIVE
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">
                      Không có chu kỳ đang hoạt động
                    </p>
                  );
                })()
              )}
              <button
                onClick={() => {
                  setCycleModalOpen(true);
                  setCycleError("");
                }}
                className="text-xs text-gray-600 font-medium px-3 py-1.5 rounded-lg border border-gray-200 active:bg-gray-50 transition-colors shrink-0"
              >
                Switch Cycle
              </button>
            </div>

            {/* Cycle switch modal */}
            {cycleModalOpen && (
              <div
                className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
                onClick={() => setCycleModalOpen(false)}
              >
                <div
                  className="w-full max-w-[480px] bg-white rounded-t-3xl flex flex-col max-h-[80vh] modal-slide-up"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
                    <h2 className="text-base font-bold text-gray-900">Cycle</h2>
                    <button
                      onClick={() => setCycleModalOpen(false)}
                      className="p-1 rounded-full text-gray-400 hover:text-gray-600"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  {/* Cycle list */}
                  <div className="overflow-y-auto max-h-72 px-6">
                    {cycles.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900">
                            {c.id}
                          </span>
                          {c.status === "active" && (
                            <span className="text-[10px] font-bold bg-green-500 text-white px-1.5 py-0.5 rounded-md">
                              ACTIVE
                            </span>
                          )}
                        </div>
                        {c.status !== "active" && (
                          <button
                            onClick={() => handleSwitchCycle(c.id)}
                            disabled={switchingId !== null}
                            className="text-xs text-gray-600 font-medium px-3 py-1.5 rounded-lg border border-gray-200 active:bg-gray-50 disabled:opacity-50 transition-colors"
                          >
                            {switchingId === c.id ? "..." : "Switch"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Create new cycle */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-4 mt-3">
              <p className="text-xs text-gray-400 mb-2">Tạo chu kỳ mới</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCycleId}
                  onChange={(e) => {
                    setNewCycleId(e.target.value);
                    setCycleError("");
                  }}
                  placeholder="YYYY-MM (ie. 2026-04)"
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-600"
                />
                <button
                  onClick={handleCreateCycle}
                  disabled={cycleWorking}
                  className="bg-blue-600 text-white text-sm font-medium px-4 py-2.5 rounded-xl disabled:opacity-50"
                >
                  {cycleWorking ? "..." : "Thêm"}
                </button>
              </div>
              {cycleError && (
                <p className="text-xs text-red-500 mt-2">{cycleError}</p>
              )}
            </div>
          </div>

          {/* ── Users ── */}
          <div>
            <p className="text-base font-bold text-gray-900 mb-3">Người dùng</p>

            {/* Add user form */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-4 mb-3">
              <p className="text-xs text-gray-400 mb-3">Thêm người dùng mới</p>
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={newPin}
                    onChange={(e) => {
                      setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4));
                      setUserError("");
                    }}
                    placeholder="PIN"
                    className="w-24 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-600 font-mono tracking-widest text-center"
                  />
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setUserError("");
                    }}
                    placeholder="Tên hiển thị"
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div className="flex gap-2">
                  {/* Role toggle */}
                  <div className="flex rounded-xl border border-gray-200 overflow-hidden flex-1">
                    {[
                      { value: "user", label: "User" },
                      { value: "admin", label: "Admin" },
                    ].map((r) => (
                      <button
                        key={r.value}
                        onClick={() => setNewRole(r.value)}
                        className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                          newRole === r.value
                            ? "bg-blue-600 text-white"
                            : "text-gray-400"
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={handleAddUser}
                    disabled={userWorking}
                    className="bg-blue-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl disabled:opacity-50"
                  >
                    {userWorking ? "..." : "Thêm"}
                  </button>
                </div>
                {userError && (
                  <p className="text-xs text-red-500">{userError}</p>
                )}
              </div>
            </div>

            {/* User list */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {usersLoading ? (
                <p className="text-center text-gray-400 py-8 text-sm">
                  Đang tải...
                </p>
              ) : users.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">
                  Không có người dùng
                </p>
              ) : (
                <div>
                  {users.map((u) => (
                    <div
                      key={u.id}
                      className="px-4 py-3.5 border-b border-gray-100 last:border-b-0"
                    >
                      {confirmDeleteId === u.id ? (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">
                            Xoá {u.display_name}?
                          </span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs text-gray-500 font-medium px-3 py-1.5 rounded-lg border border-gray-200"
                            >
                              Không
                            </button>
                            <button
                              onClick={() => handleDeleteUser(u.id)}
                              className="text-xs text-white font-medium px-3 py-1.5 rounded-lg bg-red-600"
                            >
                              Xoá
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900 truncate">
                                {u.display_name}
                              </span>
                              {u.role === "admin" && (
                                <span className="text-[10px] font-bold bg-gray-900 text-white px-1.5 py-0.5 rounded-md shrink-0">
                                  ADMIN
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-gray-400 font-mono">
                              PIN: {u.pin}
                            </span>
                          </div>
                          {u.id !== user.id && (
                            <button
                              onClick={() => setConfirmDeleteId(u.id)}
                              className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors shrink-0"
                              aria-label="Xoá"
                            >
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
