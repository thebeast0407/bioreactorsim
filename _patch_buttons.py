"""Replace terminal-based recovery prompt with in-figure buttons."""
import re

with open("bioreactorsim.py", "r", encoding="utf-8") as fh:
    src = fh.read()

# ══════════════════════════════════════════════════════════════════════════════
# 1. GridSpec: reserve bottom margin for the recovery bar
# ══════════════════════════════════════════════════════════════════════════════
src = src.replace(
    "        gs = GridSpec(3, 3, figure=fig,\n"
    "                      width_ratios=[1.35, 1, 1], hspace=0.45, wspace=0.38)\n",
    "        gs = GridSpec(3, 3, figure=fig,\n"
    "                      width_ratios=[1.35, 1, 1], hspace=0.45, wspace=0.38,\n"
    "                      bottom=0.10, top=0.97)\n",
)

# ══════════════════════════════════════════════════════════════════════════════
# 2. Add recovery bar axes + buttons before fig.canvas.draw()
# ══════════════════════════════════════════════════════════════════════════════
BEFORE_DRAW = "        fig.canvas.draw()\n        plt.pause(0.001)\n"
RECOVERY_BAR = (
    "        # ── Recovery action bar ───────────────────────────────────────────\n"
    "        from matplotlib.widgets import Button as _Btn\n"
    "        ax_rec_info = fig.add_axes([0.01, 0.025, 0.55, 0.055])\n"
    "        ax_rec_info.set_facecolor('#F8F9FA')\n"
    "        ax_rec_info.tick_params(left=False, bottom=False,\n"
    "                                labelleft=False, labelbottom=False)\n"
    "        for _sp in ax_rec_info.spines.values():\n"
    "            _sp.set_edgecolor('#ccc'); _sp.set_linewidth(0.5)\n"
    "        rec_info_txt = ax_rec_info.text(\n"
    "            0.01, 0.5, '  No active recovery prompts',\n"
    "            va='center', ha='left', fontsize=9, fontfamily='monospace',\n"
    "            transform=ax_rec_info.transAxes,\n"
    "        )\n"
    "        ax_btn_yes = fig.add_axes([0.57, 0.025, 0.19, 0.055])\n"
    "        btn_yes = _Btn(ax_btn_yes, '\\u2713  Apply Recovery',\n"
    "                       color='#D4EDDA', hovercolor='#A8D5BA')\n"
    "        btn_yes.label.set_fontsize(9)\n"
    "        ax_btn_no  = fig.add_axes([0.77, 0.025, 0.19, 0.055])\n"
    "        btn_no  = _Btn(ax_btn_no,  '\\u2717  Decline',\n"
    "                       color='#FDDCDC', hovercolor='#F5ABAB')\n"
    "        btn_no.label.set_fontsize(9)\n"
    "        ax_btn_yes.set_visible(False)\n"
    "        ax_btn_no.set_visible(False)\n\n"
)
if BEFORE_DRAW not in src:
    raise RuntimeError("fig.canvas.draw() anchor not found")
src = src.replace(BEFORE_DRAW, RECOVERY_BAR + BEFORE_DRAW, 1)

# ══════════════════════════════════════════════════════════════════════════════
# 3. Add recovery bar refs to the ln dict
# ══════════════════════════════════════════════════════════════════════════════
src = src.replace(
    "            fault_drawn=set(),\n        )",
    (
        "            fault_drawn=set(),\n"
        "            rec_info_txt=rec_info_txt,\n"
        "            rec_ax_info=ax_rec_info,\n"
        "            rec_ax_yes=ax_btn_yes,\n"
        "            rec_ax_no=ax_btn_no,\n"
        "            rec_btn_yes=btn_yes,\n"
        "            rec_btn_no=btn_no,\n"
        "            rec_cids=[],\n"
        "        )"
    ),
)

# ══════════════════════════════════════════════════════════════════════════════
# 4. Add _hide_recovery_bar / _show_recovery_bar helpers before _check_recovery_prompts
# ══════════════════════════════════════════════════════════════════════════════
# Write helpers as a single regular string (no f-string nesting issues)
HELPERS = [
    "    def _hide_recovery_bar(self, ln: dict) -> None:\n",
    "        for btn, cid in ln.get('rec_cids', []):\n",
    "            try:\n",
    "                btn.disconnect(cid)\n",
    "            except Exception:\n",
    "                pass\n",
    "        ln['rec_cids'] = []\n",
    "        ln['rec_ax_yes'].set_visible(False)\n",
    "        ln['rec_ax_no'].set_visible(False)\n",
    "        ln['rec_info_txt'].set_text('  No active recovery prompts')\n",
    "        ln['rec_ax_info'].set_facecolor('#F8F9FA')\n",
    "        for sp in ln['rec_ax_info'].spines.values():\n",
    "            sp.set_edgecolor('#ccc'); sp.set_linewidth(0.5)\n",
    "\n",
    "    def _show_recovery_bar(self, ln: dict, f: dict, t_now: float) -> None:\n",
    "        self._hide_recovery_bar(ln)\n",
    "        fe       = self.fault_engine\n",
    "        fname    = f['name']\n",
    "        fid      = f['id']\n",
    "        rec_name = RECOVERY_NAMES.get(fid, 'Standard Recovery')\n",
    "        deadline = t_now + 2.0\n",
    "        ln['rec_info_txt'].set_text(\n",
    "            f'  \\u26a0  {fname}  \\u203a  {rec_name}'\n",
    "            f'  \\u2502  auto-N at t={deadline:.1f} h'\n",
    "        )\n",
    "        ln['rec_ax_info'].set_facecolor('#FFF3CD')\n",
    "        for sp in ln['rec_ax_info'].spines.values():\n",
    "            sp.set_edgecolor('#ff7f0e'); sp.set_linewidth(1.0)\n",
    "        ln['rec_ax_yes'].set_visible(True)\n",
    "        ln['rec_ax_no'].set_visible(True)\n",
    "\n",
    "        def _on_yes(event, fault=f):\n",
    "            fault['_awaiting_input'] = False\n",
    "            fe.recover(self, fault)\n",
    "            self._hide_recovery_bar(ln)\n",
    "\n",
    "        def _on_no(event, fault=f):\n",
    "            fault['_awaiting_input'] = False\n",
    "            fn = fault['name']\n",
    "            print(f'\\n  Recovery declined \\u2014 {fn!r} remains active.\\n')\n",
    "            self._hide_recovery_bar(ln)\n",
    "\n",
    "        cid_yes = ln['rec_btn_yes'].on_clicked(_on_yes)\n",
    "        cid_no  = ln['rec_btn_no'].on_clicked(_on_no)\n",
    "        ln['rec_cids'] = [(ln['rec_btn_yes'], cid_yes),\n",
    "                          (ln['rec_btn_no'],  cid_no)]\n",
    "\n",
]
HELPERS_STR = "".join(HELPERS)

CHECK_ANCHOR = "    def _check_recovery_prompts(self) -> None:\n"
if CHECK_ANCHOR not in src:
    raise RuntimeError("_check_recovery_prompts anchor not found")
src = src.replace(CHECK_ANCHOR, HELPERS_STR + CHECK_ANCHOR, 1)

# ══════════════════════════════════════════════════════════════════════════════
# 5. Rewrite _check_recovery_prompts (button + timeout, no stdin)
# ══════════════════════════════════════════════════════════════════════════════
old_pat = re.compile(
    r"    def _check_recovery_prompts\(self\) -> None:.*?(?=\n    def )",
    re.DOTALL,
)
NEW_CHECK = [
    "    def _check_recovery_prompts(self) -> None:\n",
    "        \"\"\"Button-based recovery UI embedded in the figure.\n",
    "        Auto-declines if no response within 2 simulated hours.\"\"\"\n",
    "        if not self.fault_engine:\n",
    "            return\n",
    "        fe    = self.fault_engine\n",
    "        ln    = getattr(self, '_ln', None)\n",
    "        if ln is None:\n",
    "            return\n",
    "        t_now = self.state.time\n",
    "\n",
    "        # timeout check on the active prompt\n",
    "        for f in fe.faults:\n",
    "            if f.get('_awaiting_input') and not f.get('_recovered'):\n",
    "                elapsed = t_now - f.get('_prompt_time_h', t_now)\n",
    "                if elapsed >= 2.0:\n",
    "                    f['_awaiting_input'] = False\n",
    "                    fname = f['name']\n",
    "                    self._hide_recovery_bar(ln)\n",
    "                    print(\n",
    "                        f'\\n  \\u23f1  No response after 2 simulated hours \\u2014 '\n",
    "                        f'recovery auto-declined for {fname!r}.\\n'\n",
    "                    )\n",
    "                else:\n",
    "                    remaining = 2.0 - elapsed\n",
    "                    fname     = f['name']\n",
    "                    rec_name  = RECOVERY_NAMES.get(f['id'], 'Recovery')\n",
    "                    ln['rec_info_txt'].set_text(\n",
    "                        f'  \\u26a0  {fname}  \\u203a  {rec_name}'\n",
    "                        f'  \\u2502  auto-N in {remaining:.1f} h  (t={t_now:.1f} h)'\n",
    "                    )\n",
    "                return\n",
    "\n",
    "        # issue the next pending prompt\n",
    "        for f in fe.faults:\n",
    "            if (\n",
    "                f.get('_needs_recovery_prompt')\n",
    "                and not f.get('_prompt_started')\n",
    "                and not f.get('_recovered')\n",
    "            ):\n",
    "                f['_prompt_started'] = True\n",
    "                f['_awaiting_input'] = True\n",
    "                f['_prompt_time_h']  = t_now\n",
    "                self._show_recovery_bar(ln, f, t_now)\n",
    "                break\n",
    "\n",
]
NEW_CHECK_STR = "".join(NEW_CHECK)

m = old_pat.search(src)
if not m:
    raise RuntimeError("_check_recovery_prompts body not found")
src = src[:m.start()] + NEW_CHECK_STR + src[m.end():]

# ══════════════════════════════════════════════════════════════════════════════
# 6. Store ln on self in run_live
# ══════════════════════════════════════════════════════════════════════════════
src = src.replace(
    "        plt.ion()\n        fig, ln, free_axes = self._build_dashboard()\n",
    "        plt.ion()\n        fig, ln, free_axes = self._build_dashboard()\n"
    "        self._ln = ln   # accessible by _check_recovery_prompts\n",
    1,
)

with open("bioreactorsim.py", "w", encoding="utf-8") as fh:
    fh.write(src)
print("Patch applied.")
