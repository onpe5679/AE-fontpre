#!/usr/bin/env python3
"""
Font Name Matcher - 폰트 이름 비교 유틸리티

영문/한글 폰트 이름 차이를 고려한 스마트 매칭 로직
"""


def is_same_font_family(requested_name: str, actual_name: str) -> bool:
    """
    두 폰트 이름이 같은 폰트 패밀리인지 판단합니다.
    
    영문/한글 이름 차이를 무시하고 같은 폰트인지 확인합니다.
    
    Examples:
        - "Sandoll Aram 05" vs "Sandoll 아람 05" → True
        - "210 Supersize" vs "210 수퍼사이즈" → True
        - "210 Santorini" vs "Arial" → False
    
    Args:
        requested_name: 요청한 폰트 이름
        actual_name: 실제 선택된 폰트 이름
    
    Returns:
        bool: 같은 폰트 패밀리면 True
    """
    if not requested_name or not actual_name:
        return False
    
    # 1. 완전 일치 (대소문자 무시)
    if requested_name.lower().strip() == actual_name.lower().strip():
        return True
    
    # 2. 영문/숫자만 추출해서 비교
    req_alphanumeric = extract_alphanumeric_key(requested_name)
    act_alphanumeric = extract_alphanumeric_key(actual_name)
    
    # 최소 길이 체크 (너무 짧으면 의미 없음)
    if len(req_alphanumeric) < 3 or len(act_alphanumeric) < 3:
        return False
    
    # 3. 앞부분이 매칭되면 같은 폰트로 간주
    # 예: "sandollaram05" in "sandoll05" 또는 그 반대
    if req_alphanumeric in act_alphanumeric or act_alphanumeric in req_alphanumeric:
        return True
    
    # 4. 숫자+주요 키워드 매칭
    # "210supersize" vs "210" 같은 경우
    if has_common_numeric_prefix(req_alphanumeric, act_alphanumeric):
        return True
    
    return False


def extract_alphanumeric_key(font_name: str) -> str:
    """
    폰트 이름에서 영문과 숫자만 추출합니다.
    
    - 한글, 공백, 특수문자 제거
    - 소문자로 변환
    
    Examples:
        "Sandoll 아람 05" → "sandoll05"
        "210 수퍼사이즈 Black" → "210black"
    """
    # ASCII 영문자와 숫자만 추출
    alphanumeric = ''.join(
        c.lower() for c in font_name 
        if c.isalnum() and ord(c) < 128
    )
    return alphanumeric


def has_common_numeric_prefix(name1: str, name2: str) -> bool:
    """
    두 이름이 같은 숫자 접두사를 공유하는지 확인합니다.
    
    Examples:
        "210supersize" vs "210" → True (둘 다 210으로 시작)
        "109boxtape" vs "109" → True
        "sandoll" vs "arial" → False
    """
    # 숫자로 시작하는지 확인
    prefix1 = extract_numeric_prefix(name1)
    prefix2 = extract_numeric_prefix(name2)
    
    if not prefix1 or not prefix2:
        return False
    
    # 숫자 접두사가 같고, 하나는 숫자만 있거나 둘 다 추가 텍스트가 있음
    return prefix1 == prefix2 and (
        len(prefix1) >= 2  # 최소 2자리 숫자
    )


def extract_numeric_prefix(text: str) -> str:
    """
    문자열 앞부분의 숫자만 추출합니다.
    
    Examples:
        "210supersize" → "210"
        "109box" → "109"
        "sandoll" → ""
    """
    prefix = ''
    for c in text:
        if c.isdigit():
            prefix += c
        else:
            break
    return prefix


def is_system_default_font(font_name: str) -> bool:
    """
    시스템 기본 폰트인지 확인합니다.
    
    이 폰트들로 대체되었다면 진짜 substitution입니다.
    """
    font_name_lower = font_name.lower().strip()
    
    # Windows 기본 폰트들
    system_fonts = [
        'arial',
        'times new roman',
        'courier new',
        'calibri',
        'segoe ui',
        'tahoma',
        'verdana',
        'ms gothic',
        'ms mincho',
        '굴림',
        '돋움',
        '바탕',
        '궁서'
    ]
    
    return font_name_lower in system_fonts


def should_treat_as_substitution(requested: str, actual: str) -> bool:
    """
    Font substitution으로 처리해야 하는지 최종 판단합니다.
    
    Returns:
        True: 진짜 substitution, PIL 폴백 필요
        False: 같은 폰트의 다른 이름, GDI 결과 사용 가능
    """
    # 1. 같은 폰트 패밀리면 OK
    if is_same_font_family(requested, actual):
        return False
    
    # 2. 시스템 기본 폰트로 대체되었으면 진짜 문제
    if is_system_default_font(actual):
        return True
    
    # 3. 그 외의 경우는 일단 다른 폰트로 간주
    return True
