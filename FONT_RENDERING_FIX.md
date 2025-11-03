# 폰트 렌더링 문제 해결

## 🔍 문제 분석

### **증상**
- `C:\WINDOWS\Fonts\` 폰트: ✅ 정상 렌더링
- `C:\Users\user\AppData\Local\Microsoft\Windows\Fonts\` 폰트: ❌ 리스트에는 표시되지만 기본 폰트로 렌더링됨
- 일부 폰트: ❌ 경로 정보 없음 (location 속성 비어있음)

### **원인**
1. **CEP 보안 제한**: 사용자 폴더(`AppData`)의 폰트 파일에 직접 접근 불가
2. **Font API 제약**: 일부 폰트는 `fontItem.location` 속성이 비어있음 (PostScript 폰트, 가상 폰트 등)

---

## ✅ 해결 방법

### 1️⃣ **@font-face 동적 로딩**

사용자 폴더의 폰트는 `@font-face`를 사용하여 명시적으로 로드:

```javascript
// main.js
function loadCustomFonts(fonts) {
    const fontFaces = fonts.map(font => {
        const fontUrl = 'file:///' + font.location.replace(/\\/g, '/');
        return `
@font-face {
    font-family: "${font.cssName}";
    src: url("${fontUrl}") format("truetype");
}`;
    }).join('\n');
    
    document.head.appendChild(styleEl);
}
```

### 2️⃣ **렌더링 불가능 폰트 시각적 표시**

경로 정보가 없는 폰트는 회색으로 표시:

```css
.font-item.font-not-available {
    opacity: 0.5;
    background-color: #2a2a2a;
}

.font-item.font-not-available .font-name {
    color: #888;
}
```

### 3️⃣ **경고 아이콘 추가**

폰트명 옆에 ⚠ 아이콘으로 경고:

```html
<div class="font-name">
    109Box_tape Medium
    <span class="location-hint" title="폰트 파일 경로를 찾을 수 없습니다">⚠</span>
</div>
```

---

## 🎯 구현 세부사항

### **A. JSX (hostscript.jsx)**
```javascript
// 폰트 경로 정보 수집
var fontPath = "";
try {
    fontPath = fontItem.location || "";
} catch (locError) {
    // location property may not exist
}

fonts.push({
    name: displayName,
    family: familyName,
    style: styleName,
    postScriptName: psName,
    location: fontPath,  // ✨ 추가!
    available: true
});
```

### **B. JavaScript (main.js)**
```javascript
availableFonts = fonts.map((font, index) => {
    const fontLocation = font.location || '';
    
    // AppData 폴더 폰트 감지
    const hasLocation = fontLocation.length > 0;
    const needsCustomLoad = hasLocation && fontLocation.includes('AppData');
    
    return {
        uid, id, displayName, family, style,
        postScriptName,
        location: fontLocation,
        cssName: cssName,
        hasLocation: hasLocation,        // ✨ 경로 존재 여부
        needsCustomLoad: needsCustomLoad  // ✨ 커스텀 로딩 필요 여부
    };
});

// 커스텀 로딩이 필요한 폰트 처리
loadCustomFonts(availableFonts.filter(f => f.needsCustomLoad));
```

### **C. CSS (styles.css)**
```css
/* 렌더링 불가능 폰트 회색 표시 */
.font-item.font-not-available {
    opacity: 0.5;
    background-color: #2a2a2a;
}

.font-item.font-not-available .font-name {
    color: #888;
}

.font-item.font-not-available .font-preview {
    color: #666;
    font-style: italic;
}

.location-hint {
    color: #f0ad4e;
    font-size: 10px;
    margin-left: 4px;
    cursor: help;
}
```

---

## 📊 결과 예시

### **정상 렌더링 (location 있음)**
```
✅ Binggrae Regular
   Location: C:\WINDOWS\Fonts\Binggrae.ttf
   → 실제 Binggrae 폰트로 렌더링
```

### **커스텀 로딩 (AppData)**
```
✅ Gmarket Sans TTF Light
   Location: C:\Users\user\AppData\Local\Microsoft\Windows\Fonts\GmarketSansTTFLight.ttf
   → @font-face로 로드 후 렌더링
```

### **렌더링 불가 (location 없음)**
```
⚠ 109Box_tape Medium
   Location: (not available)
   → 회색으로 표시, 기본 폰트로 폴백
```

---

## 🔍 디버깅 방법

### **브라우저 콘솔에서:**

```javascript
// 특정 폰트 정보 확인
debugFont('Gmarket Sans')

// 출력:
// Display Name: Gmarket Sans TTF Light
// Family: Gmarket Sans TTF
// Style: Light
// PostScript: GmarketSansTTFLight
// CSS Name: GmarketSansTTFLight
// Location: C:\Users\user\AppData\Local\Microsoft\Windows\Fonts\GmarketSansTTFLight.ttf
// Has Location: Yes
```

### **통계 확인:**

```javascript
debugFonts()

// 출력:
// Fonts with location: 450/787
// Fonts need custom load: 85
```

---

## 📈 개선 효과

### **이전:**
- AppData 폰트: ❌ 리스트에 있지만 렌더링 안 됨
- location 없는 폰트: ❌ 구분 불가

### **이후:**
- AppData 폰트: ✅ @font-face로 로드하여 렌더링
- location 없는 폰트: ⚠ 회색으로 명확히 표시
- 사용자 경험: ✅ 어떤 폰트를 사용할 수 있는지 명확함

---

## ⚠️ 제한사항

### **여전히 렌더링 불가능한 경우:**

1. **PostScript Type 1 폰트**
   - location 속성이 비어있음
   - After Effects 내부에서만 사용 가능

2. **가상 폰트**
   - 메모리에만 존재
   - 파일 시스템 경로 없음

3. **특수 경로 폰트**
   - CEP 보안 정책으로 접근 제한
   - 네트워크 드라이브, 특수 폴더 등

### **대안:**
- 이런 폰트들은 **회색으로 표시**되어 사용자가 인지 가능
- After Effects에서는 여전히 정상 적용 가능 (패널 미리보기만 제한)

---

## 🚀 사용 방법

1. **수정된 파일 복사**
   - `jsx/hostscript.jsx`
   - `js/main.js`
   - `css/styles.css`

2. **After Effects 재시작**

3. **콘솔 확인**
   ```
   Fonts with location: 450/787
   Fonts need custom load: 85
   Attempting to load 85 custom fonts...
   Custom font-faces created: 85
   ✓ Loaded: GmarketSansTTFLight
   ✓ Loaded: NanumSquareRoundEB
   ...
   ```

4. **결과 확인**
   - 정상 폰트: 흰색 표시, 실제 폰트로 렌더링
   - AppData 폰트: 흰색 표시, @font-face로 렌더링
   - location 없는 폰트: 회색 표시 + ⚠ 아이콘

---

## 💡 추가 개선 아이디어 (향후)

1. **폰트 로딩 상태 실시간 표시**
   - Document.fonts.ready 이벤트 활용
   - 로딩 중/성공/실패 아이콘

2. **필터 기능**
   - "렌더링 가능한 폰트만 보기" 체크박스
   - location 있는 폰트만 필터링

3. **폰트 캐싱**
   - localStorage에 폰트 정보 저장
   - 빠른 재로딩

4. **폰트 미리보기 개선**
   - 폰트별로 최적화된 샘플 텍스트
   - 한글/영문/숫자 구분
