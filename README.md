# Convenient_BOJ

백준(acmicpc.net) 문제 화면에서 **문제 읽기 → 코드 작성 → 실행 → 제출 → 정/오답 확인**을 한 화면에서 끝낼 수 있게 해 주는 크롬 확장 프로그램입니다.

```
┌──────────────┬──────────────────────────┐
│              │  코드 작성   [▶ 실행][제출] │
│     문제      ├──────────────────────────┤
│              │  정/오답 확인 | 터미널      │
└──────────────┴──────────────────────────┘
```

![분할 화면](docs/screenshots/02-split-view.jpg)

## 기능

### ⇆ 분할 화면 (문제 | 코드)
- 문제 페이지(`/problem/번호`)에서 제목 옆 **[⇆ 코드 작성]** 버튼이나 **Alt + C**로 엽니다.
- 왼쪽에는 원래 문제가 그대로 있고, 오른쪽에 코드 에디터와 결과 창이 붙습니다.
- 패널 왼쪽 경계와 에디터·결과 사이 경계를 끌어서 크기를 바꿀 수 있어요(크기는 기억돼요).
- 작성한 코드는 **문제·언어별로 자동 저장**돼서 다시 열어도 그대로 있어요.
- 코드 작성에는 VS Code의 **Monaco Editor**를 사용해요. 선택한 텍스트를 끌어서 옮기거나, Alt+클릭으로 여러 곳을 동시에 편집할 수 있어요. Shift+Alt를 누르고 끌면 열을 선택해요. 미니맵은 팝업에서 켤 수 있어요.
- **들여쓰기**는 팝업에서 고를 수 있어요.
  - **탭**(기본): Tab 키가 탭 문자 하나를 넣고, Backspace 한 번에 지워져요. 들여쓰기의 탭은 화살표로, 공백은 점으로 보여요.
  - **공백 4칸**: Tab 키가 공백을 4칸 단위로 넣고, 줄 앞 공백은 Backspace 한 번에 4칸씩 지워져요.
- **엔터 자동 들여쓰기는 VS Code 규칙**을 따라요.
  - C/C++: 닫히지 않은 `{` 또는 `(`로 끝나는 줄 다음만 한 단계 들여쓰기 (`;`가 빠진 줄, `if (x)` 다음은 같은 깊이)
  - Python: `def`/`if`/`for`/`while`/`else`… 로 시작해 `:`로 끝나는 줄, 열린 괄호로 끝나는 줄 다음은 들여쓰기, `return`/`pass`/`break`/`continue`/`raise` 다음은 내어쓰기
  - 괄호 쌍 사이(`{|}`, `(|)`, `[|]`)에서 엔터를 누르면 가운데 줄을 만들고 닫는 괄호는 원래 깊이로
- 새 문제를 열 때 들어가는 **기본 코드는 팝업에서 언어별로 바꿀 수 있어요.** `$0` 자리에 커서가 놓여요.
  다시 열면 마지막으로 작업하던 위치로 돌아가요.
  - C++: 백준 권장 빠른 입출력(`ios::sync_with_stdio(false); cin.tie(nullptr);`)이 들어간 형태
  - C: `stdio.h` + `main` 뼈대
  - Python: 빈 코드 (빠른 입력이 필요하면 `import sys` / `input = sys.stdin.readline` 을 추가해 두세요)

![코드 작성 버튼](docs/screenshots/01-toggle-button.jpg)

### ▶ 실행: C / C++ / Python
- **실행**(Ctrl + Enter)을 누르면 결과 창이 **터미널**로 바뀌고, 문제의 **예제 입력으로 코드를 돌려 예제 출력과 비교**해요.
  - 틀린 예제는 입력 / 기대 출력 / 내 출력을 나란히 보여 줘요.
  - 컴파일 에러, 런타임 에러, stderr도 그대로 보여 줘요.
- 터미널 아래 칸에서 **직접 실행**할 수 있어요.
  - [내 PC 실행 도우미](#2단계-내-pc에서-실행-진짜-터미널-선택)를 설치했다면 **VS Code 터미널처럼** 동작해요. 프로그램이 실행 중일 때 입력하고 Enter를 치면 바로 전달돼요. Ctrl+C로 중지, Ctrl+D로 입력 끝.
  - 로컬 도구가 없으면 코드와 입력을 Wandbox에 보낼지 실행할 때 물어봐요. 동의하면 결과를 한꺼번에 보여 줘요.
- 터미널 탭 오른쪽 위에 지금 **실행 위치**(● 내 PC / ● Wandbox)가 보여요.
- 언어 목록은 백준 [언어 설정]에서 고른 언어를 따라요. C(C99/C11/…), C++(C++14/17/20/…, Clang 포함), Python 3 / PyPy3 를 지원해요.
- 팝업의 **실행 환경**에서 MSVC, GCC 또는 Wandbox를 고를 수 있어요. 자동 모드는 C++17/20에 설치된 x64 MSVC를 우선하고, 다른 C++ 표준에는 가능한 경우 GCC를 사용해요. 백준 제출 언어는 따로 유지돼요.
- MSVC는 `/O2 /EHsc /utf-8`, 선택한 `/std:c++17` 또는 `/std:c++20`과 `ONLINE_JUDGE`, `BOJ` 매크로를 사용해요. GCC는 `-O2 -std=<언어 버전> -DONLINE_JUDGE -DBOJ`를 쓰고 C에는 `-lm`을 추가해요.
- MSVC의 새 C++ 코드는 `<iostream>`으로 시작해요. GNU 전용 `bits/stdc++.h`, `__int128` 등이 필요한 코드는 GCC로 실행할 수 있어요. 대화형 출력은 필요할 때 `std::flush`나 `std::endl`로 비워 주세요.
- 같은 탭에서 소스, 컴파일 설정과 헤더가 같으면 빌드 결과를 재사용해요. 예제 실행 중 **■ 중지**를 누르면 컴파일이나 실행을 취소할 수 있어요.

| 예제 통과 | 예제 틀림 | 컴파일 에러 (어두운 테마) |
| --- | --- | --- |
| ![](docs/screenshots/03-run-pass.jpg) | ![](docs/screenshots/04-run-wrong.jpg) | ![](docs/screenshots/05-compile-error-dark.jpg) |

### 제출 → 정/오답 확인
1. 분할 화면(A)에서 **제출**(Ctrl + Shift + Enter)을 누르면 같은 창의 바로 옆에 백준 제출 탭(B)이 열리고, **작성한 코드와 언어가 채워져 있어요.**
2. B에서 백준의 **[제출]** 버튼만 누르면 돼요.
   백준 제출에는 보안 확인(reCAPTCHA)이 있어서, 마지막 버튼은 사람이 직접 눌러야 해요.
3. 제출하자마자 **포커스가 A로 돌아와요.** B는 뒤에서 채점 현황을 지켜보고,
   A의 **정/오답 확인** 탭에 `채점 중 → 맞았습니다!!` 가 실시간으로 표시돼요.
4. 채점이 끝나면 **B는 자동으로 닫혀요.** 채점 전에 B를 직접 닫으면 A에 "제출 기록 열기" 안내가 떠요.

| 채워진 제출 탭 | 분할 화면에 뜬 결과 |
| --- | --- |
| ![](docs/screenshots/06-submit-window-filled.jpg) | ![](docs/screenshots/07-judge-result-ac.jpg) |

- 메모리·시간·코드 보기 링크와 **이 문제 내 제출 기록** 링크를 함께 보여 줘요.
- 코드 공개 설정은 팝업에서 고를 수 있어요(기본값: 백준 설정을 따름).

## 설치

### 1단계: 확장 프로그램 (필수)

1. [Releases](https://github.com/gaudium1257/Convenient_BOJ/releases/latest)에서 **Convenient_BOJ.zip** 을 내려받아 압축을 풉니다.
2. 크롬 주소창에 `chrome://extensions` 를 입력합니다.
3. 오른쪽 위 **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드합니다** → 압축을 푼 `Convenient_BOJ` 폴더를 고릅니다.
5. 백준 문제 페이지를 새로고침하면 끝!

> 압축을 푼 폴더는 지우지 마세요. 크롬이 그 폴더에서 확장을 읽어요.

도우미 없이 온라인으로 실행하려면 Wandbox 전송 안내에서 동의하거나 팝업에서 Wandbox를 선택해요.

### 2단계: 내 PC에서 실행 (진짜 터미널, 선택)

코드를 내 PC에서 컴파일·실행하고, VS Code처럼 실행 중에 입력을 주고받는 **진짜 터미널**을 쓰려면 (Windows):

1. 압축을 푼 폴더의 **`host\install.bat`** 을 더블클릭해요.
2. 묻는 대로 답해요. (모두 Enter = 예)
   - Python이 없으면 설치할지 물어봐요. (도우미가 Python으로 동작해요)
   - 설치된 Visual Studio 또는 Build Tools의 x64 C++ 도구와 Windows SDK를 자동으로 찾아요. MSVC와 g++를 찾지 못하면 WinLibs 설치 여부를 물어봐요. Python만 쓰면 건너뛰어도 돼요.
3. 백준 문제 탭을 새로고침하면 터미널 탭 오른쪽 위가 **● 내 PC** 로 바뀌어요.

- 관리자 권한은 필요 없어요. 도우미는 `%LOCALAPPDATA%\ConvenientBOJ` 에 설치되고 크롬·엣지·웨일에 등록돼요.
- 지우려면 `host\uninstall.bat` 을 실행해요. (Python·gcc는 지우지 않아요)
- 이전 도우미에서 MSVC를 사용하려면 새 폴더의 `host\install.bat`을 다시 실행하고 문제 탭을 새로고침해요. 기존 도구로 Chrome에만 등록할 때는 PowerShell에서 `.\host\install.ps1 -RegisterOnly -ChromeOnly`를 실행해요.

### 업데이트
새 ZIP을 받아 같은 폴더에 덮어쓴 뒤, `chrome://extensions` 에서 Convenient BOJ의 새로고침(↻)을 누르고 백준 탭도 새로고침해 주세요.

### 새 버전 배포하기 (개발자용)
`manifest.json` 의 `version` 을 올리고 같은 번호로 태그를 올리면, GitHub Actions가 ZIP을 만들어 Releases에 올려요.

```powershell
git tag v1.0.1; git push origin v1.0.1
```

## 단축키

| 키 | 동작 |
| --- | --- |
| Alt + C | 분할 화면 열기/닫기 |
| Ctrl + Enter | 예제로 실행 |
| Ctrl + Shift + Enter | 제출 탭 열기 |
| Ctrl + S | 코드 저장 |
| Ctrl + Space | 언어 키워드·문서 안 단어 완성 |
| Ctrl + F | 편집기 안에서 찾기 (왼쪽 화살표로 바꾸기 열기) |
| Alt + ↑ / ↓ | 줄 이동 |
| Shift + Alt + ↑ / ↓ | 줄 복제 |

## 알아 두면 좋은 점

- **코드 실행 위치:** 내 PC 도우미는 현재 사용자의 권한으로 코드를 실행해요. Wandbox를 선택하면 코드와 입력이 그 서버로 보내져요. 로컬 실행 시간은 백준 채점 시간과 다를 수 있어요.
- 1.3.0부터 확장 프로그램 ID를 고정했어요(도우미가 이 확장의 요청만 받도록). 그 전 버전을 쓰던 경우, 처음 한 번은 저장된 코드·설정이 초기화될 수 있어요.
- **제출은 백준의 진짜 제출 페이지에서 해요.** 확장은 코드를 채워 주고 결과를 읽어 올 뿐, 비밀번호나 로그인 정보를 따로 다루지 않아요.
  백준은 스크립트로 보내는 요청에 빈 응답을 주기 때문에, 확장이 몰래 대신 제출하는 방식은 쓰지 않아요.
- 작성 중인 코드와 설정은 브라우저(`chrome.storage`) 안에만 저장돼요.

## 구조

```
manifest.json            확장 설정 (MV3)
background.js            코드 실행(Wandbox API), 내 PC 도우미 연결, 제출 탭 열기·포커스·닫기
content/split.js         분할 화면: 에디터, 실행 터미널, 제출 탭 열기, 채점 결과 표시
content/split.css
content/editor.js        초안·커서와 편집기 프레임 연결
editor/                  확장 전용 Monaco 편집 화면
content/submit.js        제출 페이지: 코드·언어 채우기 안내, 언어 목록 저장
content/submit-main.js   제출 페이지(페이지 world): 백준 에디터에 코드 넣기
content/status.js        채점 현황 페이지: A로 포커스 돌리기, 결과를 분할 화면으로 전달
popup/                   설정 팝업
host/                    내 PC 실행 도우미(cboj_host.py)와 설치·제거 스크립트
shared/defaults.js       공통 기본 설정
shared/boj.js            채점 결과 읽기
vendor/monaco/           Monaco Editor·워커·글꼴·라이선스
tools/monaco/            고정 버전 편집기 빌드 (npm ci, npm run build)
docs/screenshots/        실제 동작 캡처
.github/workflows/       태그를 올리면 Releases에 ZIP 배포
```
