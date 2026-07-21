import { useMemo } from "react";

import { useLayoutStore } from "./layout-store.ts";
import { PRIMARY_MODEL_ROLES, useSessionStore } from "../session/session-store.ts";
import type { ModelRoleAssignment } from "../session/types.ts";

/** Chip label: model id (+ optional :thinking), no provider prefix. */
const chipModelLabel = (role: ModelRoleAssignment) => {
  const raw = role.shortLabel?.trim() || role.selector?.trim() || "";
  if (!raw || raw === "—") return "—";
  const base = raw.includes(":") ? raw.slice(0, raw.lastIndexOf(":")) : raw;
  const thinking = raw.includes(":") ? raw.slice(raw.lastIndexOf(":")) : "";
  const model = base.includes("/") ? base.slice(base.lastIndexOf("/") + 1) : base;
  const label = `${model}${thinking}`;
  return label.length > 28 ? `${label.slice(0, 27)}…` : label;
};

export const RoleModelStrip = () => {
  const modelRoles = useSessionStore((state) => state.modelRoles);
  const openDrawer = useLayoutStore((state) => state.openDrawer);
  const setAgentsFocusRole = useLayoutStore((state) => state.setAgentsFocusRole);

  const roles = useMemo(() => {
    const preferred = new Set<string>(PRIMARY_MODEL_ROLES);
    const map = new Map(modelRoles.map((role) => [role.role, role]));
    const ordered = [
      ...PRIMARY_MODEL_ROLES.map((role) => map.get(role)).filter(Boolean),
      ...modelRoles.filter((role) => !preferred.has(role.role)),
    ] as ModelRoleAssignment[];

    for (const role of PRIMARY_MODEL_ROLES) {
      if (!ordered.some((item) => item.role === role)) {
        ordered.unshift({
          role,
          selector: "",
          shortLabel: "—",
        });
      }
    }

    const seen = new Set<string>();
    return ordered
      .filter((role) => {
        if (seen.has(role.role)) return false;
        seen.add(role.role);
        return true;
      })
      .slice(0, 8);
  }, [modelRoles]);

  const openAgents = (role: string) => {
    setAgentsFocusRole(role);
    openDrawer("agents");
  };

  return (
    <div className="runtime-strip__roles" aria-label="OMP model roles">
      {roles.map((role) => {
        const unset = !role.selector;
        const label = chipModelLabel(role);
        const full = role.selector?.trim() || "configure in Agents";
        return (
          <button
            key={role.role}
            type="button"
            className={`role-chip${unset ? " is-unset" : ""}`}
            title={`${role.role}: ${full}`}
            onClick={() => openAgents(role.role)}
          >
            <span className="role-chip__role">{role.role}</span>
            <span className="role-chip__model">{label}</span>
          </button>
        );
      })}
    </div>
  );
};
