# -*- coding: utf-8 -*-
"""
AAD Site 를 라이노 명령어로 등록한다 — 한 번만 실행하면 된다.

등록 후에는 라이노 명령행에 `AAD` 만 치면 대지 가져오기가 시작된다.
스크립트 파일을 찾아 _RunPythonScript 하는 과정이 사라진다.

사용: _RunPythonScript → rhino/install_aad.py
"""

import os

import Rhino
import rhinoscriptsyntax as rs

ALIAS = "AAD"
SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "aad_site.py")

# 별칭 매크로. 경로에 공백이 있어도 되도록 따옴표로 감싼다.
# 앞의 ! 는 진행 중인 명령을 취소하고 시작하라는 뜻이다.
MACRO = '! _-RunPythonScript ("%s")' % SCRIPT


def install():
    """별칭을 등록하고 (갱신 여부, 매크로) 를 돌려준다. 대화상자를 띄우지 않는다."""
    if not os.path.isfile(SCRIPT):
        raise IOError("aad_site.py 를 찾을 수 없습니다: %s" % SCRIPT)

    existing = rs.AliasMacro(ALIAS)
    if existing:
        rs.DeleteAlias(ALIAS)
    rs.AddAlias(ALIAS, MACRO)

    # 별칭은 라이노가 정상 종료할 때 설정 파일에 기록된다.
    # (RhinoApp.SaveSettings 는 Rhino 7 에 없다)
    return bool(existing), rs.AliasMacro(ALIAS)


def main():
    try:
        updated, _ = install()
    except IOError as e:
        rs.MessageBox(unicode(e), 16, u"AAD 설치")
        return

    verb = u"갱신" if updated else u"등록"
    Rhino.RhinoApp.WriteLine("AAD 명령어 %s 완료 → %s" % (verb, SCRIPT))
    rs.MessageBox(
        u"명령어 '%s' 를 %s했습니다.\n\n"
        u"이제 라이노 명령행에 %s 를 치면 바로 실행됩니다.\n"
        u"(서버가 꺼져 있으면 자동으로 켭니다)" % (ALIAS, verb, ALIAS),
        0,
        u"AAD 설치",
    )


if __name__ == "__main__":
    main()
